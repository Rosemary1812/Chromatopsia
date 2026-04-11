# Session 层设计

> 文档基于 `packages/agent/src/session/` 已实现代码分析

## 概述

Session 层负责管理对话上下文生命周期，包括内存中的消息状态、持久化存储、以及长对话的上下文压缩。整个层分为 4 个模块：

| 模块 | 文件 | 职责 |
|------|------|------|
| SessionManager | manager.ts | 会话创建 / 获取 / 恢复 / 压缩 |
| SessionHistory | history.ts | JSONL 持久化 + index.json 索引 |
| SessionSummarizer | summarizer.ts | 上下文压缩（truncate / summarize） |
| Context Builder | context.ts | LLM 上下文组装 |

---

## 模块详解

### 1. SessionManager

**位置**：`packages/agent/src/session/manager.ts`

#### Session ID 生成

```
格式：{sha1(working_directory)[0:8]}-{random_4chars}-{timestamp_36}
示例：a3f2d1b0-xy7z-20260410abc123def
```

基于工作目录 hash 生成，同一项目每次启动的 hash 前缀相同，便于人工识别。

#### SessionImpl 实现

`SessionImpl` 是 `Session` 接口的内存实现，持有：

- `messages[]` — 内存消息列表
- `project_context` / `user_context` — 项目和用户上下文
- `last_compact_metadata` — 最近一次压缩元数据

关键方法：
- `add_message()` — 追加消息到内存，同时调用 `SessionHistory.append_message_sync()` 持久化
- `compact()` — 调用 `truncate_history()`，由 `SessionManager` 执行保守截断

#### 三段式恢复

`recover_or_prompt()` 方法实现：

```
0 个活跃 session → create_session() 新建
1 个活跃 session → 从 JSONL 加载消息到 SessionImpl，自动恢复
多个活跃 session → 返回 candidates[] 供用户选择
```

活跃 session 的判定：`!archived && working_directory === 当前目录`

#### 截断策略

`truncate_history()` 采用保守截断：

```typescript
estimated_tokens = messages.length * 200
threshold = 4500
if (estimated_tokens <= threshold) return

preserve_recent = 4
// 丢弃旧消息，保留最近 4 条
```

每条消息按 200 tokens 估算（非精确），超过阈值才截断。截断后记录 `CompressionMetadata { type: 'truncate', original_count, preserved_count }`。

---

### 2. SessionHistory

**位置**：`packages/agent/src/session/history.ts`

#### 存储结构

```
{history_dir}/
├── index.json              # Session 索引（元数据）
└── {session_id}.jsonl      # 每行一条 Message JSON
```

#### index.json 结构

```json
{
  "sessions": [
    {
      "session_id": "a3f2d1b0-xy7z-20260410abc123def",
      "working_directory": "D:/project/myapp",
      "created_at": 1744281600000,
      "last_active": 1744282000000,
      "message_count": 42,
      "archived": false
    }
  ]
}
```

#### 持久化保证

`append_message_sync()` 同时写 index 和 jsonl：

1. 读 index.json（同步）
2. 更新对应 session 的 `last_active` 和 `message_count`
3. 写 index.json（同步）
4. 追加一行到 `{session_id}.jsonl`

**关键设计**：使用同步 I/O 保证 crash-safe，不依赖异步状态。对调用方（`SessionImpl.add_message`）无 async 负担。

#### JSONL 读写

- **写**：每条消息 `JSON.stringify(message) + '\n'` 追加到文件
- **读**：`readFile` → `split('\n')` → 逐行 `JSON.parse`，跳过 corrupted lines

#### archive_session

仅修改 index.json 标记 `archived: true`，不删除 jsonl 文件。Session 从内存中删除但历史可恢复。

---

### 3. SessionSummarizer

**位置**：`packages/agent/src/session/summarizer.ts`

#### 压缩策略

| 策略 | 触发条件 | 结果 |
|------|---------|------|
| `truncate` | 无 LLM provider 或调用失败 | 直接丢弃旧消息，保留最近 N 条 |
| `summarize` | 有可用 LLM provider | 调用 LLM 生成中文摘要，插入为 system 消息 |

#### 压缩流程（compress_session）

```
1. 保留最近 preserve_recent 条消息（尾部锚定）
2. 其余消息送 LLM 生成摘要
3. 摘要格式：【历史摘要】{LLM生成的中文摘要}
4. 新消息列表 = [摘要msg, ...preserved]
```

#### 摘要 Prompt

```
请将以下对话历史压缩为一段简洁的摘要。
要求：
1. 保留关键决策、已完成的工作、当前任务状态
2. 忽略无关的试错过程
3. 用中文输出，200 字以内
4. 摘要需要让后续 Agent 能接续当前工作
```

#### 递归压缩

`compress_session_recursive()` 支持压缩后仍超限时递归再压，最多 3 次迭代。

#### 配置项

```typescript
DEFAULT_COMPRESSION_CONFIG = {
  compress_threshold: 4500,   // 触发压缩的 token 估算阈值
  preserve_recent: 4,         // 保留最近消息数
  min_summarizable: 6,       // 至少 6 条旧消息才值得 summarize，否则直接截断
}
```

---

### 4. Context Builder

**位置**：`packages/agent/src/session/context.ts`

#### LLMContext 组装 Pipeline

```
build_llm_context()
  │
  ├─ 1. build_system_prompt()
  │     - Chromatopsia 角色定义
  │     - project_context（项目名、语言、框架、描述）
  │     - user_context（用户名、用户偏好）
  │
  ├─ 2. Skill 注入
  │     - 精确匹配 → build_skill_injection() 完整 skill block
  │     - 无匹配   → fuzzy_match Top 3 → build_related_skills_injection()
  │
  └─ 3. format_recent_messages()
        - 过滤 user/assistant 消息
        - 格式：【对话历史】用户：xxx\n助手：yyy\n...
        - 默认 limit=20
```

#### Skill 注入格式

精确匹配时输出完整 block：
```
【技能】SkillName
触发条件：xxx
步骤：
  1. xxx
  2. xxx
常见陷阱：
  - xxx
验证方法：xxx
```

模糊匹配时仅输出名称和触发条件（Top 3）。

#### LLMContext 接口

```typescript
interface LLMContext {
  messages: Message[];
  appendAssistantChunk(chunk: string): void;   // 流式收集
  finalizeStream(): LLMResponse;               // 流结束
  showNotification(msg: string): void;         // REPL 通知
  finishAssistantMessage(content: string): void; // 写入 session
}
```

---

## 数据流

```
用户输入
    │
    ▼
Session.add_message(message)
    │  同步写 JSONL
    ▼
build_llm_context(session, task_type, matched_skill, skill_reg)
    │
    ├── System Prompt
    ├── Skill Injection
    └── Recent Messages (≤20)
    │
    ▼
LLMProvider.chat(messages)
    │
    ▼
compress_session()  ← 每条消息后检查是否超阈值
    │
    ├── needs_compression() → false  → 无操作
    ├── needs_compression() → true
    │     ├── 有 LLM provider → summarize 策略
    │     └── 无 LLM provider → truncate 策略
    └── metadata 写入 session.last_compact_metadata
```

---

## 关键设计决策

### 1. JSONL + 同步 I/O

每条消息追加写入，单文件顺序读。不做随机写、不做 SQL，最大限度减少数据损坏风险。同步写确保每次 `add_message` 后 crash 恢复不会丢消息。

### 2. Session 与 History 分离

SessionManager 持有 `Map<id, SessionImpl>` 内存索引；SessionHistory 持有文件 I/O 逻辑。内存只放活跃 session，归档即删除内存引用但保留 jsonl 历史。

### 3. 截断优先于 summarize

当 LLM provider 不可用或调用失败时，降级为纯截断，不阻塞对话。summarize 是增强功能而非唯一压缩手段。

### 4. 尾部锚定

无论 truncate 还是 summarize，都保留最近消息作为"锚"，确保对话尾部上下文不丢失。Preserved 消息作为压缩后继续对话的基础。

### 5. Token 估算

用 `messages.length * 200` 做粗估，不依赖外部 tokenizer。这是保守估算（偏大），实际 token 数通常更少，因此压缩触发会偏晚，但不会误触发。

---

## 相关文件索引

| 文件 | 作用 |
|------|------|
| `packages/agent/src/session/manager.ts` | SessionManager + SessionImpl |
| `packages/agent/src/session/history.ts` | SessionHistory + JSONL I/O |
| `packages/agent/src/session/summarizer.ts` | compress_session / needs_compression |
| `packages/agent/src/session/context.ts` | build_llm_context / build_system_prompt |
| `packages/agent/src/types.ts` | Session / Message / CompressionMetadata 接口定义 |
