# Chromatopsia Agent

> 面向开发者的 AI 编程 Agent，核心理念：深度整合 LLM，具备自学习能力的终端编程助手。

---

## 目录结构

```
packages/agent/
├── src/
│   ├── index.ts                    # 统一导出入口
│   ├── foundation/
│   │   ├── types.ts                # 全部核心类型定义
│   │   ├── llm/                    # LLM Provider 层
│   │   │   ├── index.ts            # Provider 工厂 (createProvider)
│   │   │   ├── provider.ts          # LLMProvider 接口
│   │   │   ├── anthropic.ts        # Anthropic Provider 实现
│   │   │   └── openai.ts           # OpenAI Provider 实现
│   │   └── tools/                  # Tool 系统
│   │       ├── index.ts            # register_all_tools()
│   │       ├── registry.ts         # ToolRegistry（全局注册中心）
│   │       ├── executor.ts         # execute_tool + 并行执行
│   │       ├── bash.ts             # run_shell（dangerous）
│   │       ├── read.ts             # Read（safe）
│   │       ├── edit.ts             # Edit（warning）
│   │       ├── glob.ts             # Glob（safe）
│   │       ├── grep.ts             # Grep（safe）
│   │       ├── websearch.ts        # WebSearch（safe）
│   │       └── webfetch.ts         # WebFetch（safe）
│   ├── agent/
│   │   └── session/
│   │       ├── manager.ts          # SessionManager（会话生命周期）
│   │       ├── history.ts          # SessionHistory（JSONL 持久化）
│   │       ├── summarizer.ts       # 上下文自动压缩（LLM 摘要）
│   │       └── context.ts          # LLM 上下文构建管道
│   ├── memory/
│   │   └── storage.ts             # SkillStore（跨会话持久化，JSON 文件）
│   ├── skills/
│   │   ├── registry.ts            # SkillRegistry（技能匹配/管理）
│   │   └── patcher.ts             # SkillPatcher（失败自动校准）
│   ├── hooks/
│   │   └── approval.ts           # ApprovalHook（危险操作审批）
│   ├── repl/
│   │   ├── loop.ts               # REPL 主循环（双状态机）
│   │   ├── executor.ts           # REPL 层并行执行 + Skill 执行器
│   │   ├── reflection.ts         # 反思状态机（技能合成）
│   │   ├── slash.ts              # 斜杠命令存根
│   │   └── app.ts                # CLI 入口
│   └── config/
│       └── loader.ts             # YAML 配置加载 + 环境变量替换
├── tests/                        # 单元测试（vitest）
├── verification/                 # 各阶段验证文档
└── package.json
```

---

## 已实现功能

### 1. LLM Provider 层（`foundation/llm/`）

| 模块 | 说明 |
|------|------|
| `createProvider()` | 工厂函数，根据 `anthropic` / `openai` 类型路由 |
| `AnthropicProvider` | 支持流式 (`chat_stream`) 和非流式 (`chat`) 调用，含指数退避重试 |
| `OpenAIProvider` | Function Calling 实现，流式支持，含 tool call 参数增量解析 |
| `LLMProvider` 接口 | 抽象接口，可扩展自定义 Provider |

**特性**：
- 流式调用 `AsyncGenerator<chunk, LLMResponse>`，返回最终 `LLMResponse`
- 支持 `on_tool_call_start` / `on_tool_call_end` 回调（Anthropic）
- 指数退避重试（Anthropic，429 可重试，401/403 不重试）
- tool call 参数 JSON 增量累积（流式中部分参数拼装）

### 2. Tool 系统（`foundation/tools/`）

**7 个内置 Tool**：

| Tool | 危险等级 | 说明 |
|------|----------|------|
| `Read` | safe | 读文件，支持 offset/limit，带行号输出 |
| `Edit` | warning | 精确字符串替换，写文件沙箱校验 |
| `Glob` | safe | 递归/非递归 glob 模式匹配 |
| `Grep` | safe | 正则搜索，支持 glob 过滤和上下文行 |
| `run_shell` | dangerous | 执行 shell 命令，含路径沙箱 + 危险命令黑名单 |
| `WebSearch` | safe | 网页搜索 |
| `WebFetch` | safe | 抓取 URL 内容，转 Markdown |

**Tool Registry**：
- 全局单例 `registry`，注册/查询/列举
- 优先 Zod schema 运行时校验，降级 JSON Schema
- 危险模式自动识别（`rm -rf`、`git push -f` 等）

**Tool Executor**：
- `safe` 级别并行执行
- `warning` / `dangerous` 级别串行执行
- 沙箱路径校验（相对路径 resolve 到 working_directory，禁止逃逸）

### 3. Session 管理（`agent/session/`）

| 模块 | 说明 |
|------|------|
| `SessionManager` | 会话创建/获取/归档，消息追加，压缩协调 |
| `SessionHistory` | JSONL 持久化（`sessions/index.json` + `sessions/{id}.jsonl`） |
| `Summarizer` | LLM 摘要压缩，降级截断，递归压缩 |
| `context.ts` | 构建 LLM 上下文（system prompt → skill 注入 → 对话历史） |

**特性**：
- Session ID 格式：`{dir_hash_8chars}-{random}-{timestamp_36}`
- 同目录只维护一个活跃 Session（自动归档旧 Session）
- 启动时三段式恢复：无活跃 → 新建；一个活跃 → 自动恢复；多个 → 候选列表
- 上下文超阈值时 LLM 摘要 + 尾部锚定 + 降级截断

### 4. 危险操作审批（`hooks/approval.ts`）

- `dangerous` 级别工具全部触发审批
- `warning` 级别工具在以下场景触发：
  - Edit：涉及 >5 行改动，或目标为敏感路径
  - run_shell：命令匹配危险正则
- 审批超时 5 分钟，自动拒绝
- 支持 `approve` / `reject` / `edit`（修改参数后通过）三种决策

### 5. 自学习技能系统（`skills/` + `memory/`）

**SkillRegistry**：
- 三层匹配：精确 `match()` → `trigger_match()` 权重匹配 → `fuzzy_match()`
- `trigger_match` 权重：正则 +100，关键词 +50，单词 +10，name +5，阈值 >30
- 支持注册/更新/删除/列出/搜索

**SkillPatcher**：
- 执行失败时分析错误模式，追加 pitfalls，修正 steps
- 支持 git、权限、冲突、超时等常见错误类型

**SkillStore**：
- 持久化到 `~/.chromatopsia/skills.json`
- 启动时全量加载，内存 Map 缓存

### 6. 反思机制（`repl/reflection.ts`）

- **Idle 触发**：用户空闲 30s 后检查 TaskBuffer
- **连续操作触发**：同类操作连续 N 次无 skill 命中
- LLM Synthesis：分析操作序列，生成新 Skill（JSON）
- 反思流程：观察 → 归类 → 合成 → 持久化

### 7. REPL 主循环（`repl/loop.ts`）

**双状态机**：
- **Normal 状态**：用户输入 → Skill 前置匹配 → LLM → 工具执行 → 循环
- **Reflection 状态**：TaskBuffer 累积 → LLM Synthesis → 生成 Skill

**执行策略**：
- 用户输入先 `trigger_match()`，命中则跳过 LLM 直接执行 Skill
- 工具执行：`safe` 并行，`warning/dangerous` 串行 + 审批
- TaskBuffer 自动记录，每次 `compact()` 检查是否需要压缩
- Idle 超时后触发反思，生成技能并持久化

### 8. 配置加载（`config/loader.ts`）

- 加载 `config.yaml`，支持 `${VAR_NAME}` 环境变量占位符替换
- 变量不存在时替换为空字符串，不抛出错误
- 配置文件不存在时抛出友好错误

---

## 架构设计

### 核心设计原则

1. **Agent 核心先行** — packages/agent 是纯库，无 UI 依赖，可独立测试
2. **Provider 可插拔** — 通过 `LLMProvider` 接口抽象，随时替换
3. **Tool 可扩展** — 新增 Tool 只需注册到 Registry
4. **Approval 不可绕过** — 危险操作必须暂停，无 silent fallback
5. **自学习优先** — 重复操作自动固化为 Skill，无需人工干预
6. **最小上下文** — 渐进式 skill 披露，避免 token 浪费

### 数据流

```
用户输入
    ↓
REPL Loop（双状态机）
    ├→ Skill 前置匹配（trigger_match）
    │      ↓ 命中 → execute_skill() → 返回
    │
    └→ Normal 状态
           ↓
       LLM (chat_stream)
           ↓
       Tool Executor（safe 并行 / guarded 串行）
           ↓
       TaskBuffer 记录
           ↓
       反思检查（连续次数 / idle 超时）
           ↓
       Synthesis → 新 Skill → 持久化
           ↓
       循环直到 LLM 输出文本
           ↓
       Session 追加消息 → JSONL 持久化
```

### 依赖关系

```
config/loader.ts        ← YAML 解析，无其他依赖
foundation/types.ts     ← 所有其他模块的共同依赖
foundation/llm/        ← 仅依赖 types.ts
foundation/tools/      ← 依赖 types.ts
agent/session/         ← 依赖 types.ts, llm/
skills/                ← 依赖 types.ts
memory/                ← 依赖 types.ts
hooks/approval.ts      ← 依赖 types.ts, tools/registry
repl/executor.ts       ← 依赖 types.ts, tools/, hooks/, skills/
repl/reflection.ts     ← 依赖 types.ts, skills/
repl/loop.ts           ← 依赖以上所有模块
repl/app.ts            ← CLI 入口，依赖 repl/loop.ts, config/
index.ts               ← 统一导出
```

### 扩展点

- **新增 LLM Provider**：实现 `LLMProvider` 接口，在 `createProvider()` 中注册
- **新增 Tool**：定义 `ToolDefinition`，调用 `registry.register()`
- **新增 Hook**：实现 `ToolHook` 接口，注册到 Hooks 入口
- **新增 Slash 命令**：在 `slash.ts` 的 `SLASH_COMMANDS` 中注册

### 配置格式

```yaml
provider: anthropic  # anthropic | openai

anthropic:
  api_key: ${ANTHROPIC_API_KEY}
  model: claude-opus-4-6
  max_tokens: 8192

openai:
  api_key: ${OPENAI_API_KEY}
  base_url: https://api.openai.com/v1
  model: gpt-4o

tools:
  run_shell:
    denied_patterns:
      - ^rm\s+-rf
      - ^sudo

approval:
  auto_approve_safe: true
  timeout_seconds: 300

session:
  compress_threshold: 4500
  preserve_recent: 4
  min_summarizable: 6

reflection:
  enabled: true
  threshold: 3
  idle_timeout: 30000
  max_buffer_size: 50
```

### 技术栈

| 类别 | 依赖 |
|------|------|
| LLM SDK | `@anthropic-ai/sdk`, `openai` |
| 验证 | `zod` |
| 持久化 | Node.js `fs/promises`（JSON + JSONL） |
| 网络 | `turndown`（HTML → Markdown） |
| 语法高亮 | `highlight.js` |
| 测试 | `vitest` |
| TUI | `ink` + `react`（terminal 包） |
| CLI | `tsx`（dev 模式） |

详细设计文档见 `../../../Program/agent/DESIGN.md`。
