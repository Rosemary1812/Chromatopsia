# Session 层设计决策

## 背景

Phase 4 实现了 Chromatopsia Agent 的 Session 层，目标是管理对话生命周期、持久化历史消息、压缩长对话上下文。

## 核心设计

### 四个模块各司其职

| 模块 | 文件 | 职责 |
|------|------|------|
| SessionManager | manager.ts | 会话创建/获取/恢复/删除，内存 session 集合 |
| SessionHistory | history.ts | 持久化层，jsonl 追加写入 |
| SessionContext | context.ts | 构建发给 LLM 的完整消息上下文 |
| SessionSummarizer | summarizer.ts | 对话压缩，控制 token 消耗 |

### Session ID 生成策略

```
格式：{working_dir_hash_8chars}-{random_4chars}-{timestamp_36}

例如：a3f2c1b0-xyzt-1q2w3e4r5s6t
```

- 工作目录 SHA-1 前 8 位哈希做前缀，保证同一项目下 session 有辨识度
- 随机字符 + 时间戳确保全局唯一

### 三段式恢复逻辑（recover_or_prompt）

```
无活跃 session       → 直接创建新 session（冷启动，用户无感知）
恰好一个活跃 session → 自动恢复，加载历史消息到内存（静默恢复）
多个活跃 session     → 返回候选列表，让用户选择（主动询问）
```

**设计思想**："猜用户意图"——确定性场景替用户做主，不确定性场景把选择权交还。

场景示例：

- 你刚打开终端 → 没有任何历史，直接创建新 session
- 你回到之前工作的项目 → 只有一个候选，自动恢复，Agent 带着之前的上下文继续
- 你同时在搞两个项目切来切去 → 多个 session 并存，让用户自己选要恢复哪个

### 持久化方案：JSONL 追加写入

```
{history_dir}/
  index.json          # session 元数据索引
  {session_id}.jsonl  # 每条消息一行
```

**为什么用 JSONL 而不是一个大 JSON？**
- append 写入 O(1)，不需要加载整个文件
- 单条消息损坏不污染其他消息（有容错解析）
- 恢复时按行读取，天然流式

### 对话压缩：两种模式

**触发条件**：按消息数量粗估，每条约 200 tokens，默认阈值 4500 tokens（约 22 条）。

**模式 A - Summarize（优先）**：
1. 保留最近 4 条消息（尾部锚定，保持当前任务上下文）
2. 之前的消息交给 LLM 生成一段中文摘要（≤200 字）
3. 摘要作为 system 消息插入：`【历史摘要】{LLM生成的摘要}`
4. LLM 调用失败时降级到模式 B

**模式 B - Truncate（兜底）**：
- 直接丢弃旧消息，只保留最近 4 条
- 不调用 LLM，快速但丢失历史上下文

**元数据记录**：每次压缩记录 `CompressionMetadata`（type、original_count、preserved_count、compressed_at），用于排查 "为什么 Agent 忘了之前的决策"。

**递归压缩**：压缩一次后仍超阈值则递归再压，最多 3 次迭代。

### LLM 上下文构建管道（SessionContext）

按顺序拼接三层消息：

1. **System Prompt**：Agent 角色定义 + project_context + user_context
2. **Skill 目录与按需加载**：系统 prompt 只包含轻量 Skill 目录；完整 `SKILL.md` guidance 只由 Skill tool 或 slash skill 显式加载
3. **对话历史**：保留 user/assistant/tool/system 消息，由上下文压缩控制总量

返回的 `LLMContext` 携带四个回调处理流式响应和消息写入。

## 模块间依赖关系

```
REPL Loop
  ├── SessionManager.get_session()
  ├── SessionContext.build_llm_context() → 构建 LLMContext
  │     ├── Session.project_context / user_context
  │     ├── SkillRegistry.build_directory_listing()
  │     ├── slash/Skill tool 已加载的 guidance system message
  │     └── Session.messages
  ├── LLMProvider.chat_stream() → 流式调用
  │     └── LLMContext 的回调们处理响应
  ├── SessionImpl.add_message() → 写消息
  │     └── SessionHistory.append_message() → 持久化
  └── 如果消息太长 → SessionManager.truncate_history()
                        └── SessionSummarizer.compress_session()
```

## 设计亮点

1. **内存 + 磁盘分离**：活跃 session 在内存里秒速读写，历史消息落到 jsonl 持久化，启动时从磁盘恢复
2. **恢复三段式**：自动恢复单候选，多候选时才打扰用户，平衡静默恢复和显式选择
3. **压缩可降级**：优先尝试 LLM 生成摘要（质量高），失败时无缝降级到直接截断（可用性优先）
4. **Skill 渐进披露**：默认只提供轻量目录，模型或用户显式选择后才加载完整 guidance，避免上下文膨胀和宏式执行
5. **JSONL append-only**：写入性能好，单条损坏不扩散，有容错

## 关键类型定义

```typescript
interface Session {
  id: string;
  messages: Message[];
  working_directory: string;
  project_context?: ProjectContext;
  user_context?: UserContext;
  created_at: number;
  last_active: number;
  add_message(message: Message): void;
  clear(): void;
  compact(): void;
}

interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  timestamp?: number;
}

interface CompressionMetadata {
  type: 'summarize' | 'truncate';
  original_count: number;
  preserved_count: number;
  compressed_at: number;
}
```

## 讨论时间

2026-04-08，来源：Claude Code 对话
