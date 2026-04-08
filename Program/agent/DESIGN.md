# Agent 层详细设计

> 本文档描述 Agent 层各模块的详细设计，包括接口定义、数据结构、交互流程。

---

## 1. 类型定义

```typescript
// === 消息相关 ===

type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

interface Message {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;  // JSON 对象
}

interface ToolResult {
  tool_call_id: string;
  output: string;  // 成功输出或错误信息
  success: boolean;
}

// === Tool 相关 ===

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JSONSchema;   // 供 LLM 理解的 JSON Schema
  zod_schema?: z.ZodType;      // 运行时参数校验（优先于 JSON Schema）
  handler: ToolHandler;
  danger_level?: DangerLevel;  // 危险等级
}

type DangerLevel = 'safe' | 'warning' | 'dangerous';

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

interface ToolContext {
  session: Session;
  working_directory: string;
}

// === LLM Provider ===

interface LLMResponse {
  content: string;
  tool_calls?: ToolCall[];
  finish_reason: 'stop' | 'tool_use';
}

interface LLMProvider {
  name: string;

  // 初始化（加载 API Key 等）
  init(config: ProviderConfig): void;

  // 发送消息列表，获取回复
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;

  // 获取模型信息
  get_model(): string;
}

// === Session ===

interface Session {
  id: string;
  messages: Message[];  // 对话历史
  working_directory: string;
  project_context?: ProjectContext;
  user_context?: UserContext;
  created_at: number;
  last_active: number;

  // Slash 命令调用的方法
  add_message(message: Message): void;
  clear(): void;
  compact(): void;
}

// === Approval ===

interface ApprovalRequest {
  id: string;
  tool_name: string;
  args: Record<string, unknown>;
  context: string;  // 人类可读的上下文描述
  suggested_approval?: boolean;
  timestamp: number;
}

type ApprovalDecision = 'approve' | 'reject' | 'edit';

interface ApprovalResponse {
  request_id: string;
  decision: ApprovalDecision;
  modified_args?: Record<string, unknown>;  // edit 时的修改
}

// === Skill ===

interface Skill {
  id: string;
  name: string;
  trigger_condition: string;   // 触发条件描述（供 LLM 判断何时使用）
  trigger_pattern?: string;    // 可选的 regex pattern 辅助匹配
  steps: string[];             // 操作步骤
  pitfalls: string[];          // 常见陷阱
  verification?: string;       // 验证方法
  task_type: string;           // 任务类型，如 "test-debug", "git-rebase", "migration"
  created_at: number;
  updated_at: number;
  call_count: number;          // 被调用次数
  success_count: number;       // 成功次数（用于评估质量）
}

interface TaskBufferEntry {
  tool_calls: ToolCall[];
  tool_results: ToolResult[];
  task_type: string;           // LLM 推断的当前任务类型
  session_id: string;
  timestamp: number;
}

// === Reflection ===

interface ReflectionState {
  in_progress: boolean;
  task_buffer: TaskBufferEntry[];  // 当前累积的操作序列
  trigger_count: number;            // 连续无 skill 命中的同类操作次数
  last_task_type: string | null;   // 上次任务类型，用于判断是否连续
}

interface SynthesisResult {
  skill: Partial<Skill>;
  reasoning: string;           // LLM 的反思推理过程
}
```

---

## 2. LLM Provider 设计

### 2.1 抽象接口

```typescript
// src/llm/provider.ts

interface ProviderConfig {
  api_key: string;
  base_url?: string;  // 自托管时使用
  model?: string;
  max_tokens?: number;
  timeout?: number;
}

interface LLMProvider {
  name: string;

  // 非流式调用（保留兼容）
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;

  // 流式调用，yield 每个 token chunk
  chat_stream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: StreamOptions
  ): AsyncGenerator<string, LLMResponse, void>;

  get_model(): string;
}

interface StreamOptions {
  system_hint?: string;        // 追加到 system prompt 的提示词
  on_tool_call_start?: (tool_call: ToolCall) => void;
  on_tool_call_end?: (tool_call: ToolCall, result: ToolResult) => void;
}
```

### 2.2 Anthropic Provider

- 使用 `messages` API + `tools` 参数
- Tool results 以 `tool_result` 角色消息追加
- 支持 `thinking` 扩展（若启用）

```typescript
// src/llm/anthropic.ts

// 请求格式（示例）
{
  model: "claude-opus-4-6",
  max_tokens: 8192,
  messages: [
    { role: "user", content: "..." }
  ],
  tools: [
    {
      name: "run_shell",
      description: "Execute a bash command",
      input_schema: { type: "object", properties: { command: { type: "string" } } }
    }
  ]
}
```

### 2.3 OpenAI Provider

- 使用 `chat/completions` + `tools` 参数
- Function Calling 格式转换为内部 ToolCall 格式

```typescript
// src/llm/openai.ts

// 请求格式（示例）
{
  model: "gpt-4o",
  messages: [...],
  tools: [
    { type: "function", function: { name: "run_shell", description: "...", parameters: {...} } }
  ],
  tool_choice: "auto"
}
```

### 2.4 Provider 路由

```typescript
// src/llm/index.ts

function createProvider(type: 'anthropic' | 'openai', config: ProviderConfig): LLMProvider {
  switch (type) {
    case 'anthropic': return new AnthropicProvider(config);
    case 'openai': return new OpenAIProvider(config);
    default: throw new Error(`Unknown provider: ${type}`);
  }
}
```

---

## 3. Tool 系统设计

### 3.1 Tool 定义规范

每个 Tool 需要提供：

| 字段 | 说明 |
|------|------|
| `name` | 唯一名称，LLM 调用时使用 |
| `description` | 描述，供 LLM 理解何时调用 |
| `input_schema` | 参数 Schema（JSON Schema 格式） |
| `handler` | 执行函数 |
| `danger_level` | 危险等级（影响 Approval） |

### 3.2 内置 Tool 规格

#### run_shell

```typescript
ToolDefinition {
  name: 'run_shell',
  description: 'Execute a bash command in the project directory. Use for running scripts, git commands, npm, etc.',
  danger_level: 'dangerous',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Max execution time in ms (default: 60000)' }
    },
    required: ['command']
  }
}
```

**危险操作识别**（自动触发 Approval）：

```
rm -rf
git push --force
drop
delete.*
ALTER TABLE
```

#### Read

```typescript
ToolDefinition {
  name: 'Read',
  description: 'Read the contents of a file. Shows line numbers for reference.',
  danger_level: 'safe',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      offset: { type: 'number', description: 'Line number to start from (0-based)' },
      limit: { type: 'number', description: 'Max lines to read (default: 500)' }
    },
    required: ['file_path']
  }
}
```

#### Edit

```typescript
ToolDefinition {
  name: 'Edit',
  description: 'Make a targeted edit to a specific file. Use for changing, adding, or removing code.',
  danger_level: 'warning',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string', description: 'Exact text to replace (must be unique in file)' },
      new_string: { type: 'string', description: 'Replacement text' }
    },
    required: ['file_path', 'old_string', 'new_string']
  }
}
```

**Approval 条件**：文件在 `.gitignore` 外，或涉及 >5 行修改。

#### Grep

```typescript
ToolDefinition {
  name: 'Grep',
  description: 'Search for a pattern in files using regex.',
  danger_level: 'safe',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string', description: 'Directory or file to search in' },
      glob: { type: 'string', description: 'File pattern filter (e.g., "*.ts")' },
      context: { type: 'number', description: 'Lines of context before/after (default: 0)' }
    },
    required: ['pattern', 'path']
  }
}
```

#### Glob

```typescript
ToolDefinition {
  name: 'Glob',
  description: 'Find files matching a glob pattern. Also serves as list_files for directory listing (use pattern "*" for current dir, "**/*" for recursive).',
  danger_level: 'safe',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts" for recursive, "*" for current dir only)' },
      path: { type: 'string', description: 'Base directory (default: project root)' }
    },
    required: ['pattern']
  }
}
```

#### WebSearch

```typescript
ToolDefinition {
  name: 'WebSearch',
  description: 'Search the web for information. Use when you need up-to-date facts, documentation, or anything not in the codebase.',
  danger_level: 'safe',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      num_results: { type: 'number', description: 'Number of results to return (default: 5, max: 10)' }
    },
    required: ['query']
  }
}
```

**返回格式**：

```json
{
  "results": [
    {
      "title": "Page title",
      "url": "https://...",
      "snippet": "Relevant excerpt from the page",
      "source": "google" | "duckduckgo" | "other"
    }
  ]
}
```

**实现注意**：
- 默认使用 DuckDuckGo（免费，无需 API Key）
- 可配置 `WEB_SEARCH_PROVIDER` 环境变量切换为 Google SerpAPI / Tavily 等付费服务
- 每次搜索计费一次 Tool Use，不限结果条数

#### WebFetch

```typescript
ToolDefinition {
  name: 'WebFetch',
  description: 'Fetch and extract the main content from a URL. Use for reading documentation, blog posts, or any web page.',
  danger_level: 'safe',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      prompt: { type: 'string', description: 'Specific question or extract hint for the LLM to focus on' }
    },
    required: ['url']
  }
}
```

**返回格式**：

```json
{
  "title": "Page title",
  "url": "https://...",
  "content": "Extracted main text content (markdown or plain text)",
  "language": "en" | "zh" | "other"
}
```

**实现注意**：
- 使用 Turndown 将 HTML 转为 Markdown
- 自动过滤广告、导航栏、页脚等噪音内容
- 超时 15 秒，最大处理 500KB HTML

#### Write

```typescript
ToolDefinition {
  name: 'Write',
  description: 'Write or overwrite a file with the given content. Use for creating new files or replacing entire files.',
  danger_level: 'warning',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      content: { type: 'string', description: 'Full file content to write' }
    },
    required: ['file_path', 'content']
  }
}
```

**Approval 条件**：目标文件已存在（覆盖操作）时触发。

### 3.3 文件沙箱化

所有文件操作工具（Read / Edit / Write / Glob / Grep）必须将路径限制在 `working_directory` 以内。沙箱在 Tool Executor 层统一拦截：

```typescript
// src/tools/executor.ts

function resolve_path(relative_or_absolute: string, working_dir: string): string {
  const resolved = path.isAbsolute(relative_or_absolute)
    ? relative_or_absolute
    : path.resolve(working_dir, relative_or_absolute);

  // 规范化后检查是否在 working_dir 内
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(path.normalize(working_dir) + path.sep)
      && normalized !== path.normalize(working_dir)) {
    throw new Error(`Sandbox violation: ${relative_or_absolute} resolves outside working directory`);
  }
  return normalized;
}

// 所有文件工具的 handler 在执行路径操作前调用此函数
```

**run_shell 工具的路径限制**：
- 命令行中出现的所有绝对路径必须落在 `working_directory` 内
- `cd` 命令被静默重写为 `cd working_directory`
- 环境变量 `$PWD` 和 `~` 展开后校验

```typescript
// run_shell handler 中的沙箱处理
const sandboxed = sandbox_bash_command(rawCommand, working_dir);
function sandbox_bash_command(cmd: string, cwd: string): string {
  // 移除所有 cd .. 上级跳转（保留当前目录内的相对路径）
  // 拦截 ~ 展开（改为 cwd）
  // 拦截绝对路径访问 working_dir 以外
  return sanitized;
}
```

**危险模式黑名单**（强制拒绝，不触发 Approval）：

```typescript
const DENIED_PATTERNS = [
  /^\s*cd\s+\.\./,           // 向上跳转
  /~\//,                      // home 目录访问
  /\/etc\//,                  // 系统配置
  /\/proc\//,                // 进程信息
  /\/sys\//,                 // 内核信息
];
```

### 3.4 Tool Registry

```typescript
// src/tools/registry.ts

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  get_all(): ToolDefinition[];
  get_dangerous(): ToolDefinition[];  // 危险等级 >= warning
}

export const registry = new ToolRegistry();
```

### 3.4 Tool Executor

```typescript
// src/tools/executor.ts

async function execute_tool(
  tool_call: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const definition = registry.get(tool_call.name);
  if (!definition) {
    return { tool_call_id: tool_call.id, output: `Unknown tool: ${tool_call.name}`, success: false };
  }

  // 验证参数（优先 Zod schema，次选 JSON Schema）
  if (definition.zod_schema) {
    const result = definition.zod_schema.safeParse(tool_call.arguments);
    if (!result.success) {
      return { tool_call_id: tool_call.id, output: `Invalid arguments: ${result.error.message}`, success: false };
    }
  } else {
    const valid = validate_args(tool_call.arguments, definition.input_schema);
    if (!valid) {
      return { tool_call_id: tool_call.id, output: 'Invalid arguments', success: false };
    }
  }

  // 执行
  try {
    return await definition.handler(tool_call.arguments, context);
  } catch (e) {
    return { tool_call_id: tool_call.id, output: String(e), success: false };
  }
}
```

---

## 4. Session 管理

### 4.1 上下文窗口策略

```
messages[] 窗口限制：一般 4k-8k tokens（取决于模型）
system_prompt 固定，约 1k tokens
工具描述列表 ~1k tokens
实际可用上下文：3k-6k tokens
```

**截断策略（自动压缩）**：

```
当 messages 超长时（> compress_threshold tokens）：
1. 保留 system_prompt
2. 保留最近 N 条 user/assistant 消息（尾部锚定）
3. 中间消息压缩为摘要（LLM 提取关键点）
4. 最早的 Tool 结果可丢弃（不影响主流程）
```

### 4.2 上下文自动压缩（Summarizer）

#### 压缩触发条件

```typescript
// src/session/summarizer.ts

interface CompressionConfig {
  compress_threshold: number;  // 开始压缩的 token 数（默认 4500）
  preserve_recent: number;     // 保留最近 N 条完整消息（默认 4）
  min_summarizable: number;     // 至少需要多少条消息才触发压缩（默认 6）
}
```

#### 压缩流程

```
messages 超限（> compress_threshold）
        ↓
检查消息数量 ≥ min_summarizable？
        ↓ 否
直接截断旧消息（保留最近 preserve_recent 条）
        ↓ 是
调用 LLM 生成摘要
        ↓
用摘要替换中间所有消息（保留 role=system + 最近 preserve_recent）
        ↓
记录压缩元数据：{ compressed_at, original_count, summary }
```

#### 摘要生成 Prompt

```typescript
function build_summarize_prompt(messages_to_compress: Message[]): string {
  return `请将以下对话历史压缩为一段简洁的摘要。

要求：
1. 保留关键决策、已完成的工作、当前任务状态
2. 忽略无关的试错过程
3. 用中文输出，200 字以内
4. 摘要需要让后续 Agent 能接续当前工作

对话历史：
${format_messages_for_summary(messages_to_compress)}

摘要：`;
}

async function compress_session(
  messages: Message[],
  config: CompressionConfig,
  provider: LLMProvider
): Promise<{ compressed: Message[]; metadata: CompressionMetadata }> {
  const preserved = messages.slice(-config.preserve_recent);
  const to_compress = messages.slice(0, -config.preserve_recent);

  if (to_compress.length < config.min_summarizable) {
    // 消息太少，直接截断
    return {
      compressed: preserved,
      metadata: { type: 'truncate', original_count: messages.length, preserved_count: preserved.length }
    };
  }

  const summary_prompt = build_summarize_prompt(to_compress);
  const summary_response = await provider.chat([{ role: 'user', content: summary_prompt }]);

  const summary_msg: Message = {
    role: 'system',
    content: `【历史摘要】${summary_response.content}`,
  };

  return {
    compressed: [summary_msg, ...preserved],
    metadata: {
      type: 'summarize',
      original_count: messages.length,
      preserved_count: preserved.length + 1,
    }
  };
}
```

#### 压缩元数据

```typescript
interface CompressionMetadata {
  type: 'summarize' | 'truncate';
  original_count: number;
  preserved_count: number;
  compressed_at: number;
}
```

每次压缩后，将 metadata 附加到 Session，供 UI 层显示"上下文已压缩"提示。

#### 手动触发

用户可通过 `/compact` 斜杠命令手动触发压缩（见 §6.4）。

### 4.3 Session 隔离与恢复

#### 隔离策略

每个工作目录对应独立的 Session 命名空间，Session ID 由 `working_dir` + `时间戳` 生成：

```typescript
function generate_session_id(working_dir: string): string {
  const dir_hash = crypto.createHash('sha1').update(working_dir).digest('hex').slice(0, 8);
  const timestamp = Date.now().toString(36);
  return `${dir_hash}-${timestamp}`;
}
```

同一工作目录下只维护一个活跃 Session（旧 Session 自动归档）。

#### 持久化存储（JSONL）

```typescript
// src/session/history.ts

interface SessionRecord {
  session_id: string;
  working_directory: string;
  created_at: number;
  last_active: number;
  message_count: number;
}

// sessions/index.json — Session 元数据索引
[
  {
    "session_id": "a3f8b2c1-20240301",
    "working_directory": "/path/to/project",
    "created_at": 1709300000000,
    "last_active": 1709310000000,
    "message_count": 47
  }
]

// sessions/{session_id}.jsonl — 每行一条 Message
{"role":"user","content":"修复登录 bug","timestamp":1709300001000}
{"role":"assistant","content":"我来帮你看看...","timestamp":1709300002000}
{"role":"tool","tool_call_id":"tc-1","output":"..."}
...
```

#### 启动时恢复流程

```
Agent 启动
    ↓
检查 sessions/index.json
    ↓
有未关闭的 Session？
  ├─ 无 → 创建新 Session
  └─ 有 → 列出未关闭 Session
            ↓
      用户选择：
        ├─ 恢复指定 Session
        ├─ 新建 Session（归档旧）
        └─ 退出
            ↓
      加载 session.jsonl 到内存
      恢复消息历史
```

#### 恢复实现

```typescript
// src/session/history.ts

class SessionHistory {
  private sessionDir: string;

  async list_sessions(): Promise<SessionRecord[]> {
    const index = await this.read_index();
    return index.filter(r => !r.archived);
  }

  async load_session(session_id: string): Promise<Message[]> {
    const file = path.join(this.sessionDir, `${session_id}.jsonl`);
    const lines = (await readFile(file, 'utf-8')).trim().split('\n').filter(Boolean);
    return lines.map(line => JSON.parse(line));
  }

  async append_message(session_id: string, message: Message): Promise<void> {
    const file = path.join(this.sessionDir, `${session_id}.jsonl`);
    await appendFile(file, JSON.stringify(message) + '\n');
    const index = await this.read_index();
    const record = index.find(r => r.session_id === session_id);
    await this.update_index(session_id, { message_count: (record?.message_count ?? 0) + 1, last_active: Date.now() });
  }

  async archive_session(session_id: string): Promise<void> {
    // 标记为 archived，不删除文件（保留历史）
    await this.update_index(session_id, { archived: true });
  }

  async recover_or_prompt(): Promise<{ session: Session; recovered: boolean }> {
    const sessions = await this.list_sessions();
    const active = sessions.filter(s => !s.archived && s.working_directory === cwd);

    if (active.length === 0) {
      return { session: this.create_new_session(), recovered: false };
    }

    if (active.length === 1) {
      const messages = await this.load_session(active[0].session_id);
      return { session: this.build_session(active[0], messages), recovered: true };
    }

    // 多个活跃 Session，询问用户选择
    const chosen = await prompt_session_picker(active);
    const messages = await this.load_session(chosen.session_id);
    return { session: this.build_session(chosen, messages), recovered: true };
  }
}
```

#### 并发安全

- 写操作使用文件锁（`flock` / Windows `LockFileEx`）
- 多进程/多 Tab 场景下：最后一个写入者获胜，通过 `last_active` 时间戳仲裁

### 4.4 Session Manager

```typescript
// src/session/manager.ts

class SessionManager {
  private sessions = new Map<string, Session>();

  create_session(working_directory: string, project_context?: ProjectContext): Session;
  get_session(id: string): Session | undefined;
  add_message(session_id: string, message: Message): void;
  get_messages_for_llm(session_id: string): Message[];
  truncate_history(session_id: string): void;  // 窗口超限时的压缩
}
```

---

## 5. Approval 机制

### 5.1 触发条件

```
dangerous 级别工具：全部触发
warning 级别工具：以下情况触发
  - Edit：涉及 >5 行改动
  - Edit：目标文件不在白名单内
  - run_shell：命令匹配危险命令正则
```

### 5.2 交互流程

```
Agent 调用危险 Tool
       ↓
Approval Hook 拦截
       ↓
发送 ApprovalRequest 给 UI 层
       ↓
UI 层显示决策弹窗，等待用户操作
       ↓
返回 ApprovalResponse
       ↓
通过：执行 Tool，返回结果
拒绝：返回错误信息，不执行
编辑：通过但 args 替换为用户修改版
```

### 5.3 实现

```typescript
// src/hooks/approval.ts

interface ApprovalHook {
  // 返回 null 表示不需要 approval，可以执行
  // 返回 ApprovalRequest 表示需要暂停等待决策
  request_approval(
    tool_name: string,
    args: Record<string, unknown>,
    context: string
  ): ApprovalRequest | null;

  // 等待决策（异步，UI 层回调）
  wait_for_decision(request_id: string): Promise<ApprovalResponse>;
}
```

### 5.4 危险命令正则（示例）

```typescript
const DANGEROUS_PATTERNS = [
  /^rm\s+-rf/i,
  /^git\s+push\s+--force/i,
  /^dd\s+/i,
  /^mkfs/i,
  /^fdisk/i,
  /^drop\s+(table|database)/i,
  /^shutdown/i,
  /^reboot/i,
];
```

---

## 6. REPL 循环

### 6.0 流式 Markdown 渲染（Ink TUI）

使用 **Ink**（React for Terminal）作为 TUI 框架，渲染层由 React 组件构成，支持流式 Markdown 输出、Approval 弹窗、工具执行状态等复杂交互。

#### 技术选型

| 库 | 用途 |
|----|------|
| `ink` | TUI 框架，React 组件渲染到终端 |
| `react` | 组件模型，内置 useState/useEffect/useCallback |
| `ink-markdown` | Markdown 渲染（GFM 支持） |
| `highlight.js` | 代码高亮（可选，配合 ink-markdown 自定义渲染器） |
| `ink-spinner` | 工具执行中的 loading 状态 |
| `ink-select-input` | Approval 弹窗的选择交互 |

#### Ink 应用入口

```typescript
// src/repl/app.tsx

import { render, Box, Text } from 'ink';
import React from 'react';
import { App } from './components/App';

render(<App />);
```

#### 核心组件架构

```
<App>
  ├── <WelcomeBanner />           // 启动 banner
  ├── <ConversationLog />         // 历史消息滚动区域
  │     ├── <UserMessage />       // 用户输入（带 prompt 前缀）
  │     └── <AssistantMessage /> // Agent 回复（Markdown 渲染）
  │           ├── <MarkdownBlock />
  │           └── <StreamingOutput /> // 流式输出（逐 token 追加）
  ├── <ToolResultList />          // 工具执行结果
  │     └── <ToolResultItem />   // 单个结果（成功/失败样式区分）
  ├── <ApprovalModal />           // 危险操作确认弹窗（叠加层）
  └── <InputPrompt />            // 用户输入框（底部固定）
```

#### 流式 Markdown 渲染组件

Ink 默认是完整 re-render，流式逐字输出需要用 state 累积实现：

```typescript
// src/repl/components/StreamingOutput.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface Props {
  chunks: string[];  // LLM stream 的 chunk 数组
  onChunk?: (chunk: string) => void;
}

export const StreamingOutput: React.FC<Props> = ({ chunks, onChunk }) => {
  // chunks 数组在 REPL 层被 push，Ink 自动 re-render
  // 效率问题由 React 批处理缓解
  return (
    <Box flexDirection="column">
      {chunks.map((chunk, i) => (
        <MarkdownBlock key={i} content={chunk} />
      ))}
    </Box>
  );
};
```

**更优方案 — 累积字符串 state**（避免子级无限增长）：

```typescript
// src/repl/components/StreamingAssistantMessage.tsx

import React, { useState, useRef } from 'react';
import { Box } from 'ink';
import { markdownToInk } from '../utils/markdownToInk';

interface Props {
  onStreamComplete?: (fullContent: string) => void;
}

export const StreamingAssistantMessage: React.FC<Props> = ({ onStreamComplete }) => {
  const [rendered, setRendered] = useState<React.ReactNode>(null);
  const bufferRef = useRef('');
  const renderedRef = useRef<React.ReactNode>(null);

  // 外部调用：REPL 层每收到一个 chunk，就调用这个
  const appendChunk = (chunk: string) => {
    bufferRef.current += chunk;
    // 增量渲染：只重绘最新的部分
    const inkNodes = markdownToInk(bufferRef.current, renderedRef.current);
    renderedRef.current = inkNodes;
    setRendered(inkNodes);
  };

  return (
    <Box flexDirection="column" marginY={1}>
      {rendered}
    </Box>
  );
};

// 暴露给 REPL 逻辑的写入接口
export const streamingWriter = {
  appendChunk,
  getBuffer: () => bufferRef.current,
  reset: () => {
    bufferRef.current = '';
    renderedRef.current = null;
    setRendered(null);
  },
};
```

#### Markdown 转 Ink 工具函数

```typescript
// src/repl/utils/markdownToInk.ts

import React from 'react';
import { Text, Box } from 'ink';
import hljs from 'highlight.js';

function parseMarkdownToAST(md: string): ASTNode[] {
  // 简单的正则解析，支持：
  // - 标题 (# / ## / ###)
  // - 代码块 (```lang\n...\n```)
  // - 行内代码 (`code`)
  // - 粗体 (**text**)
  // - 链接 ([text](url))
  // - 列表 (- item)
  // - 段落
  // 块级元素未闭合时返回 partial 节点
}

function astToInk(nodes: ASTNode[]): React.ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'heading1':
        return <Text key={i} bold color="yellow">{node.text}</Text>;
      case 'heading2':
        return <Text key={i} bold color="cyan">{node.text}</Text>;
      case 'heading3':
        return <Text key={i} bold color="green">{node.text}</Text>;
      case 'codeBlock': {
        const highlighted = hljs.highlight(node.code, { language: node.lang || 'plaintext' }).value;
        return (
          <Box key={i} flexDirection="column" borderStyle="round" paddingX={1} borderColor="gray">
            {node.lang && <Text dimColor>{node.lang}</Text>}
            <Text color="white">{highlighted}</Text>
          </Box>
        );
      }
      case 'inlineCode':
        return <Text key={i} color="magenta">{node.text}</Text>;
      case 'bold':
        return <Text key={i} bold>{node.text}</Text>;
      case 'link':
        return <Text key={i} underline color="blue">{node.text}</Text>;
      case 'paragraph':
        return <Text key={i}>{node.children?.map(astToInk)}</Text>;
      case 'list':
        return (
          <Box key={i} flexDirection="column">
            {node.items.map((item, j) => (
              <Text key={j}>• {item}</Text>
            ))}
          </Box>
        );
      case 'partial':
        return null; // 未闭合块不渲染
      default:
        return <Text key={i}>{node.text}</Text>;
    }
  });
}

export function markdownToInk(
  buffer: string,
  previousRendered?: React.ReactNode
): React.ReactNode {
  const ast = parseMarkdownToAST(buffer);
  const inkNodes = astToInk(ast);
  return inkNodes;
}
```

#### Approval 弹窗组件

```typescript
// src/repl/components/ApprovalModal.tsx

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { BorderBox } from './BorderBox';
import { useInput } from 'ink';

interface Props {
  request: ApprovalRequest;
  onDecision: (decision: ApprovalResponse) => void;
}

export const ApprovalModal: React.FC<Props> = ({ request, onDecision }) => {
  const [selected, setSelected] = useState(0); // 0=approve, 1=edit, 2=reject
  const choices = [
    { label: 'Approve', key: 'a', color: 'green' },
    { label: 'Edit Args', key: 'e', color: 'yellow' },
    { label: 'Reject', key: 'r', color: 'red' },
  ];

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(2, s + 1));
    if (input === 'a' || input === 'A') onDecision({ request_id: request.id, decision: 'approve' });
    if (input === 'r' || input === 'R') onDecision({ request_id: request.id, decision: 'reject' });
    if (input === 'e' || input === 'E') onDecision({ request_id: request.id, decision: 'edit', modified_args: {} });
    if (key.return) {
      const decision_map: ApprovalDecision[] = ['approve', 'edit', 'reject'];
      onDecision({ request_id: request.id, decision: decision_map[selected] });
    }
  });

  return (
    <Box justifyContent="center" alignItems="center" flexDirection="column">
      <BorderBox title={`⚠  ${request.tool_name}`} borderColor="yellow">
        <Box flexDirection="column" paddingX={1}>
          <Text>{request.context}</Text>
          <Text dimColor>参数: {JSON.stringify(request.args)}</Text>
        </Box>
      </BorderBox>
      <Box flexDirection="column" marginTop={1}>
        {choices.map((c, i) => (
          <Text key={c.key} color={selected === i ? 'white' : 'gray'}>
            {selected === i ? `▸ ${c.label} [${c.key}]` : `  ${c.label} [${c.key}]`}
          </Text>
        ))}
      </Box>
      <Text dimColor>↑↓ 选择，Enter 确认</Text>
    </Box>
  );
};
```

#### 工具执行状态组件

```typescript
// src/repl/components/ToolProgress.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from 'ink-spinner';

interface Props {
  toolName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
}

export const ToolProgress: React.FC<Props> = ({ toolName, status, result }) => {
  const statusIcon = {
    pending: '○',
    running: <Spinner />,
    success: '✓',
    error: '✗',
  };
  const statusColor = {
    pending: 'gray',
    running: 'cyan',
    success: 'green',
    error: 'red',
  };

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color={statusColor[status]}>{statusIcon[status]} </Text>
        <Text dimColor>{toolName}</Text>
      </Box>
      {result && (
        <Box flexDirection="column" marginLeft={2}>
          {status === 'error' && <Text color="red">{result}</Text>}
          {status === 'success' && <Text dimColor>{result.slice(0, 200)}{result.length > 200 ? '...' : ''}</Text>}
        </Box>
      )}
    </Box>
  );
};
```

#### 整体布局

```
┌─────────────────────────────────────────────────────────┐
│  Chromatopsia v0.1  ·  Type /help for commands        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  > 帮我修复登录 bug                                      │
│                                                         │
│  ✓ Bash: git status                                    │
│  ✓ Read: src/auth/login.ts                             │
│                                                         │
│  # 分析                                                │
│  我来看看登录模块的代码...                                │
│                                                         │
│  ```typescript                                         │
│  const user = await auth.login(credentials);           │
│  ```                                                   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  ○ Grep: searching "session" in src/                   │
├─────────────────────────────────────────────────────────┤
│  > _                                                    │
└─────────────────────────────────────────────────────────┘
```

上方：对话历史滚动区（ConversationLog）
中间：当前工具执行状态（ToolProgress，工具结果）
底部：固定输入框（InputPrompt）
Approval 弹窗：叠加在上方，使用 `Box` absolute/flex overlay 覆盖

### 6.1 双状态机

REPL 内部有两个状态：**执行状态**（Normal）和**反思状态**（Reflection）。

```
用户输入
    ↓
推断 task_type（LLM 或 pattern match）
    ↓
是否匹配已有 skill？
    ├─ 是 → 注入 skill context，执行（跳过试错路径）
    └─ 否 → 进入 Normal 执行状态
                    ↓
              记录到 TaskBuffer
                    ↓
          连续 N 次同类操作无 skill 命中？
              ├─ 否 → 继续正常循环
              └─ 是 → 进入 Reflection 状态
                            ↓
                    Agent 做 synthesis
                    生成新 skill → 写入库
                            ↓
                    返回 Normal 状态
```

### 6.2 Normal 状态：主循环

> REPL 核心逻辑与渲染层分离。Agent 逻辑在 `src/repl/loop.ts`，渲染在 Ink 组件层。两者通过 React state / context 通信。

```typescript
// src/repl/loop.ts
// 不直接操作终端输出，只处理 Agent 逻辑和数据流

import { createContext, useContext } from 'react';

// REPL 状态上下文（Ink App 消费）
export interface ReplContextValue {
  appendUserMessage: (text: string) => void;
  appendAssistantChunk: (chunk: string) => void;
  finishAssistantMessage: (fullContent: string) => void;
  appendToolResult: (result: ToolResult, toolName: string) => void;
  showApproval: (req: ApprovalRequest) => Promise<ApprovalResponse>;
  showNotification: (msg: string) => void;
}

// LLM 执行上下文（REPL 逻辑层使用，包含流式状态管理）
export interface LLMContext {
  messages: Message[];
  appendAssistantChunk: (chunk: string) => void;
  finalizeStream: () => LLMResponse;
  showNotification: (msg: string) => void;
  finishAssistantMessage: (content: string) => void;
}

export const ReplContext = createContext<ReplContextValue | null>(null);

async function run_repl(options: ReplOptions) {
  const session = session_manager.create_session(options.working_dir);
  const provider = createProvider(options.provider, options.config);
  const skill_reg = new SkillRegistry();        // 技能库
  const skill_patcher = new SkillPatcher();      // 自动 patch 器
  const session_store = new SessionStore();      // 跨会话持久化

  // 从磁盘恢复历史经验
  const past_skills = session_store.load_skills();
  skill_reg.load(past_skills);

  // 反思状态（在 handleUserInput 外层维护）
  let reflection: ReflectionState = {
    in_progress: false,
    task_buffer: [],
    trigger_count: 0,
    last_task_type: null,
  };

  // 用户输入由 InputPrompt 组件捕获，通过这里注入
  async function handleUserInput(input: string): Promise<void> {
    // === 斜杠命令（不依赖 ctx，提前处理） ===
    if (handle_slash_command(input, session, skill_reg)) return;

    // === 推断 task_type（不依赖 ctx，提前处理） ===
    const task_type = await infer_task_type(input, skill_reg);
    const matched_skill = skill_reg.match(task_type);

    // === 构建消息上下文 ===
    const ctx = await build_llm_context(
      session, task_type, matched_skill, skill_reg
    );

    // === Normal 执行循环 ===
    while (true) {
      // 流式输出（通过 ctx 回传 chunk）
      for await (const chunk of provider.chat_stream(ctx.messages, registry.get_all(), {
        system_hint: matched_skill
          ? `优先参考以下技能步骤：\n${matched_skill.steps.join('\n')}`
          : undefined,
      })) {
        ctx.appendAssistantChunk(chunk);
      }
      const response = ctx.finalizeStream();  // 获取完整 response

      if (!response.tool_calls?.length) break;  // 无 tool_calls，输出文本

      // === 并行执行所有 tool_calls ===
      const results = await execute_tool_calls_parallel(
        response.tool_calls, session, provider, ctx
      );

      // === 更新 TaskBuffer ===
      if (!matched_skill) {
        add_to_task_buffer(reflection, {
          tool_calls: response.tool_calls,
          tool_results: results,
          task_type,
          session_id: session.id,
          timestamp: Date.now(),
        });

        // === 反思触发检查 ===
        if (should_trigger_reflection(reflection, task_type, options.reflection_threshold)) {
          const synthesis = await run_reflection(reflection, provider, skill_reg);
          if (synthesis.skill) {
            await skill_patcher.patch(synthesis.skill, reflection.task_buffer);
            skill_reg.register(synthesis.skill as Skill);
            session_store.save_skill(synthesis.skill as Skill);
            ctx.showNotification(`[Skill] 新技能已生成：${(synthesis.skill as Skill).name}`);
          }
          reflection = reset_reflection(reflection);
          break;  // 回到主循环，重新构建 context
        }
      }

      // === 注入 tool results，重新循环 ===
      ctx.messages = append_tool_results(ctx.messages, response.tool_calls, results);
    }

    ctx.finishAssistantMessage(response.content);
  }

  // 返回输入处理器，供 Ink App 绑定
  return { handleUserInput };
}
```

**与 Ink App 的绑定**：

```typescript
// src/repl/components/App.tsx

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { render, Box, Text } from 'ink';
import { ConversationLog } from './ConversationLog';
import { InputPrompt } from './InputPrompt';
import { ApprovalModal } from './ApprovalModal';
import { ToolProgress } from './ToolProgress';
import { NotificationBanner } from './NotificationBanner';
import { run_repl } from '../loop';
import type { ReplContextValue, ApprovalRequest, ApprovalResponse, ToolResult } from '../loop';

interface ToolState {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
}

export const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolStates, setToolStates] = useState<Map<string, ToolState>>(new Map());
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([]);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [currentAssistantChunks, setCurrentAssistantChunks] = useState<string[]>([]);

  // 当前流式输出的 buffer
  const streamingBufferRef = useRef('');

  // 存储 pending approval 的 resolve 函数
  const approvalResolversRef = useRef<Map<string, (r: ApprovalResponse) => void>>(new Map());

  const ctx: ReplContextValue = {
    appendUserMessage: useCallback((text) => {
      setMessages(m => [...m, { role: 'user', content: text }]);
    }, []),

    appendAssistantChunk: useCallback((chunk) => {
      streamingBufferRef.current += chunk;
      setCurrentAssistantChunks(c => [...c, chunk]);
    }, []),

    finishAssistantMessage: useCallback((fullContent) => {
      setMessages(m => [...m, { role: 'assistant', content: fullContent }]);
      setCurrentAssistantChunks([]);
      streamingBufferRef.current = '';
    }, []),

    appendToolResult: useCallback((result, toolName) => {
      setToolStates(m => new Map(m).set(result.tool_call_id, {
        name: toolName, status: result.success ? 'success' : 'error', result: result.output,
      }));
    }, []),

    showApproval: useCallback((req) => {
      return new Promise<ApprovalResponse>((resolve) => {
        approvalResolversRef.current.set(req.id, resolve);
        setApprovalQueue(q => [...q, req]);
      });
    }, []),

    showNotification: useCallback((msg) => {
      setNotifications(n => [...n, msg]);
      setTimeout(() => setNotifications(n => n.slice(1)), 3000);
    }, []),
  };

  // 启动 REPL 逻辑
  useEffect(() => {
    run_repl({}).then(({ handleUserInput }) => {
      // 暴露到全局，供 InputPrompt 调用
      (globalThis as any).__chromatopsia_input = handleUserInput;
    });
  }, []);

  return (
    <Box flexDirection="column">
      <ConversationLog messages={messages} streamingChunks={currentAssistantChunks} />
      <ToolProgress toolStates={toolStates} />
      {approvalQueue.length > 0 && (
        <ApprovalModal
          request={approvalQueue[0]}
          onDecision={(decision) => {
            const resolve = approvalResolversRef.current.get(approvalQueue[0].id);
            if (resolve) {
              resolve(decision);
              approvalResolversRef.current.delete(approvalQueue[0].id);
            }
            setApprovalQueue(q => q.slice(1));
          }}
        />
      )}
      {notifications.map((n, i) => (
        <NotificationBanner key={i} message={n} />
      ))}
      <InputPrompt />
    </Box>
  );
};
```
```

### 6.3 Reflection 状态：技能生成

当连续 N 次同类操作无 skill 命中时触发。Agent 在这个状态下**不做执行**，只做 synthesis。

```typescript
// src/repl/reflection.ts

const REFLECTION_THRESHOLD = 3;  // 可配置

async function run_reflection(
  reflection: ReflectionState,
  provider: LLMProvider,
  skill_reg: SkillRegistry,
): Promise<SynthesisResult> {
  const buffer_summary = summarize_task_buffer(reflection.task_buffer);

  const prompt = `
你观察到 Agent 在当前 session 中连续执行了多次同类操作但没有命中任何技能：

任务类型：${reflection.last_task_type}
操作序列：
${buffer_summary}

请反思：
1. 这些操作的共同目标是什么？
2. 标准化的步骤应该是什么？
3. 常见的陷阱有哪些？（至少 2 条）
4. 如何验证操作是否成功？

如果这些操作值得固化为可复用技能，请生成一个 Skill 对象。
如果只是一次性操作，不需要生成技能。
`;

  const response = await provider.chat([{ role: 'user', content: prompt }]);
  return parse_synthesis_result(response.content);
}
```

**触发阈值可配置**（`--reflection-threshold 3`），用户可关闭（设为 0）。

### 6.4 斜杠命令系统

```typescript
// src/repl/slash.ts

// handler 签名: (session, skill_reg, args) => void
const SLASH_COMMANDS: Record<string, {
  description: string;
  handler: (session: Session, skill_reg: SkillRegistry, args: string[]) => void;
}> = {
  '/exit': { description: '退出', handler: () => process.exit(0) },
  '/quit': { description: '退出', handler: () => process.exit(0) },
  '/clear': { description: '清空当前 session 历史', handler: (s) => s.clear() },
  '/skills': { description: '列出所有已加载技能', handler: (_, r) => r.list() },
  '/skill': { description: '查看指定技能详情 /skill <name>', handler: (_, r, args) => r.show(args[0]) },
  '/forget': { description: '删除一个技能 /forget <name>', handler: (_, r, args) => r.delete(args[0]) },
  '/compact': { description: '手动压缩当前 session 上下文', handler: (s) => s.compact() },
  '/search': { description: '搜索历史经验 /search <query>', handler: (_, r, args) => r.search(args[0]) },
  '/help': { description: '显示帮助', handler: () => console.log(get_help_text()) },
};

function get_help_text(): string {
  const lines = ['可用命令：'];
  for (const [cmd, meta] of Object.entries(SLASH_COMMANDS)) {
    lines.push(`  ${cmd} — ${meta.description}`);
  }
  return lines.join('\n');
}

function handle_slash_command(input: string, session: Session, skill_reg: SkillRegistry): boolean {
  const trimmed = input.trim();
  for (const [cmd, meta] of Object.entries(SLASH_COMMANDS)) {
    if (trimmed.startsWith(cmd)) {
      const args = trimmed.slice(cmd.length).trim().split(/\s+/);
      meta.handler(session, skill_reg, args);
      return true;
    }
  }
  return false;
}

// === 辅助函数存根（实现时补充） ===

async function infer_task_type(input: string, skill_reg: SkillRegistry): Promise<string> {
  // 方案 1：直接用 LLM 推断（每次多一次 API 调用）
  // 方案 2（推荐）：pattern match，从已有 skills 匹配关键词
  return input.split(' ')[0].toLowerCase();
}

function summarize_task_buffer(buffer: TaskBufferEntry[]): string {
  return buffer.map(e => `${e.task_type}: ${e.tool_calls.map(t => t.name).join(' → ')}`).join('\n');
}

function add_to_task_buffer(reflection: ReflectionState, entry: TaskBufferEntry): void {
  reflection.task_buffer.push(entry);
  if (reflection.last_task_type === entry.task_type) {
    reflection.trigger_count++;
  } else {
    reflection.last_task_type = entry.task_type;
    reflection.trigger_count = 1;
  }
}

function should_trigger_reflection(
  reflection: ReflectionState,
  task_type: string,
  threshold: number
): boolean {
  return reflection.trigger_count >= threshold;
}

function reset_reflection(reflection: ReflectionState): ReflectionState {
  return { ...reflection, task_buffer: [], trigger_count: 0 };
}

function append_tool_results(messages: Message[], tool_calls: ToolCall[], results: ToolResult[]): Message[] {
  const tool_messages: Message[] = results.map((result, i) => ({
    role: 'tool' as const,
    tool_call_id: tool_calls[i].id,
    content: result.output,
  }));
  return [...messages, ...tool_messages];
}

function parse_synthesis_result(content: string): SynthesisResult {
  // 从 LLM 输出中解析 Skill 对象（JSON 或结构化文本）
  try {
    const obj = JSON.parse(content);
    return { skill: obj, reasoning: '' };
  } catch {
    return { skill: {}, reasoning: content };
  }
}
```

### 6.5 并行 Tool 执行

所有 `safe` 级别的 tool_calls 并行执行，`warning` 和 `dangerous` 串行执行（需要 Approval）。

```typescript
// src/repl/executor.ts

async function execute_tool_calls_parallel(
  tool_calls: ToolCall[],
  session: Session,
  provider: LLMProvider,
  ctx: LLMContext,
): Promise<ToolResult[]> {
  const safe = tool_calls.filter(tc => registry.get(tc.name)?.danger_level === 'safe');
  const guarded = tool_calls.filter(tc => registry.get(tc.name)?.danger_level !== 'safe');

  // safe 并行
  const safe_results = await Promise.all(
    safe.map(tc => execute_tool(tc, session))
  );

  // warning/dangerous 串行（每次需要 Approval）
  const guarded_results: ToolResult[] = [];
  for (const tc of guarded) {
    const approval = await approval_hook.request_approval(tc.name, tc.arguments, ctx);
    if (approval.decision === 'reject') {
      guarded_results.push({ tool_call_id: tc.id, output: 'User rejected', success: false });
      continue;
    }
    const args = approval.modified_args ?? tc.arguments;
    guarded_results.push(await execute_tool({ ...tc, arguments: args }, session));
  }

  return [...safe_results, ...guarded_results];
}
```

### 6.6 命令行参数

```bash
# 基本用法
npx ts-node src/repl/index.ts --working-dir ./my-project

# 指定 Provider
npx ts-node src/repl/index.ts \
  --provider anthropic \
  --api-key sk-ant-... \
  --model claude-opus-4-6

# 自托管
npx ts-node src/repl/index.ts \
  --provider openai \
  --base-url http://localhost:11434/v1 \
  --api-key dummy
```

---

## 7. Tool Hooks 系统

### 7.1 Hook 类型

```typescript
type ToolHookPhase = 'before' | 'after' | 'on_error';

interface ToolHook {
  phase: ToolHookPhase;
  tool_name?: string;  // 空表示所有工具
  handler: (context: HookContext) => Promise<void> | void;
}

interface HookContext {
  tool_name: string;
  args: Record<string, unknown>;
  result?: ToolResult;
  session: Session;
}
```

### 7.2 内置 Hooks

| Hook | 阶段 | 功能 |
|------|------|------|
| `ApprovalHook` | before | 危险操作拦截 |
| `LoggingHook` | after | 记录 Tool 执行日志 |
| `CostTrackingHook` | after | 统计 token 消耗 |
| `ErrorRecoveryHook` | on_error | 失败重试逻辑 |

---

## 8. Skill 系统（自学习）

### 8.1 设计原则

技能不是一次性全部加载的，而是在需要时才被检索和注入。这种**渐进式披露**既节省上下文窗口，又让 agent 学会"先查技能再动手"。

```
任务到来
    ↓
推断 task_type
    ↓
在 SkillRegistry 中匹配（精确 > pattern > 模糊）
    ↓
找到 → 注入 steps/pitfalls 到 system hint
    ↓
未找到 → 正常执行，累积 TaskBuffer
            ↓
    连续 N 次同类无命中 → 反思 → 生成新 skill
```

### 8.2 Skill Registry

```typescript
// src/skills/registry.ts

class SkillRegistry {
  private skills = new Map<string, Skill>();   // id → Skill
  private by_type = new Map<string, Skill[]>(); // task_type → Skill[]

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
    const list = this.by_type.get(skill.task_type) ?? [];
    list.push(skill);
    this.by_type.set(skill.task_type, list);
  }

  // 精确匹配 task_type
  match(task_type: string): Skill | null {
    return this.by_type.get(task_type)?.[0] ?? null;
  }

  // 模糊匹配（搜索 trigger_condition 和 description）
  fuzzy_match(query: string): Skill[] { ... }

  update(id: string, patch: Partial<Skill>): void { ... }

  // Slash 命令
  list(): void { console.log([...this.skills.values()].map(s => `${s.name} (${s.task_type})`).join('\n')); }
  show(name: string): void { const s = [...this.skills.values()].find(s => s.name === name); console.log(JSON.stringify(s, null, 2)); }
  delete(name: string): void { const s = [...this.skills.values()].find(s => s.name === name); if (s) this.skills.delete(s.id); }
  search(query: string): void { console.log(this.fuzzy_match(query).map(s => `${s.name} — ${s.trigger_condition}`).join('\n')); }
}
```

### 8.3 技能 Patch（使用中自动校准）

当 agent 在执行某个 skill 的过程中遇到 `on_error`，触发 patch 流程：

```typescript
// src/skills/patcher.ts

class SkillPatcher {
  async patch(
    skill: Skill,
    failed_buffer: TaskBufferEntry[],
  ): Promise<void> {
    // 分析失败原因，追加到 pitfalls 或修改 steps
    const analysis = await analyze_failure(failed_buffer);
    skill.pitfalls.push(...analysis.new_pitfalls);
    skill.steps = merge_steps(skill.steps, analysis.corrections);
    skill.updated_at = Date.now();
    skill.call_count++;  // 这次算调用了
  }
}
```

### 8.4 技能生命周期

| 阶段 | 说明 |
|------|------|
| **生成** | 反思阶段由 LLM synthesis 生成初版 |
| **验证** | 下次遇到同类任务时验证是否能正确触发 |
| **使用** | 注入 context，直接走 skill 路径 |
| **校准** | on_error 时自动 patch pitfalls/steps |
| **淘汰** | call_count=0 且超过 30 天未更新 → 标记为 stale |

---

## 9. 跨会话记忆（JSON 文件 + 内存缓存）

### 9.1 技术选型

**存储**：JSON 文件（零外部依赖，git 可追踪，无 native 编译问题）
**索引**：内存 Map（启动时全量加载，按 `task_type` 精确匹配）
**写入**：写时同步持久化，读时全量加载到内存

初期 Skill 数量很小（几十到几百条），全量加载到内存几乎没有成本。**Phase 1 只用 JSON 文件**，不引入 SQLite 或其他数据库。当 Skill 数量过百后如果普通查询变慢，再考虑引入 SQLite 或 FTS5——那是性能优化阶段的事。

### 9.2 存储架构

```typescript
// src/memory/storage.ts

// 持久化文件: <homeDir>/.chromatopsia/skills.json
// homeDir 跨平台: Windows = %APPDATA%, Unix = $HOME
// 结构: Skill[] 数组

// skills.json 结构示例
[
  {
    "id": "skill-001",
    "name": "Git Rebase 交互式变基",
    "task_type": "git-rebase",
    "trigger_condition": "整理提交历史，合并多个提交，重排提交顺序",
    "steps": ["git rebase -i HEAD~N", "在编辑器中标记 pick/squash/fixup", "解决冲突后 git rebase --continue"],
    "pitfalls": ["不要在已推送的提交上执行 rebase", "冲突解决后一定要 git add 而不要 git commit"],
    "verification": "git log --oneline 查看历史是否符合预期",
    "call_count": 5,
    "success_count": 4,
    "created_at": 1712500000000,
    "updated_at": 1712600000000,
    "is_stale": false
  }
]

// 会话历史: <homeDir>/.chromatopsia/sessions/<session-id>.jsonl
// 格式: 每行一条 JSON，对应一条 Message
```

### 9.3 存储接口

```typescript
// src/memory/storage.ts

class SkillStore {
  private skills = new Map<string, Skill>();
  private storagePath: string;

  constructor(homeDir: string) {
    this.storagePath = path.join(homeDir, '.chromatopsia', 'skills.json');
  }

  async load(): Promise<void> {
    const raw = await readFile(this.storagePath, 'utf-8').catch(() => '[]');
    const arr: Skill[] = JSON.parse(raw);
    for (const s of arr) this.skills.set(s.id, s);
  }

  async save(skill: Skill): Promise<void> {
    this.skills.set(skill.id, skill);
    await ensureDir(path.dirname(this.storagePath));
    await writeFile(this.storagePath, JSON.stringify([...this.skills.values()], null, 2));
  }

  async delete(id: string): Promise<void> {
    this.skills.delete(id);
    await writeFile(this.storagePath, JSON.stringify([...this.skills.values()], null, 2));
  }

  getAll(): Skill[] { return [...this.skills.values()]; }

  byTaskType(task_type: string): Skill[] {
    return [...this.skills.values()].filter(s => s.task_type === task_type);
  }

  fuzzySearch(query: string): Skill[] {
    const q = query.toLowerCase();
    return [...this.skills.values()].filter(s =>
      s.task_type.includes(q) ||
      s.trigger_condition.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q)
    );
  }
}
```

### 9.4 上下文注入策略

```typescript
// src/memory/injector.ts

async function build_llm_context(
  session: Session,
  task_type: string,
  matched_skill: Skill | null,
  skill_reg: SkillRegistry,
): Promise<LLMContext> {
  let context_parts: string[] = [];

  // 1. System prompt（固定）
  context_parts.push(build_system_prompt(session));

  // 2. 匹配的 skill（优先注入）
  if (matched_skill) {
    context_parts.push(`【技能】${matched_skill.name}\n步骤：${matched_skill.steps.join('\n')}\n陷阱：${matched_skill.pitfalls.join('\n')}`);
  } else {
    // 3. 相关技能检索（无精确匹配时，内存 fuzzy search）
    const related = skill_reg.fuzzy_match(task_type).slice(0, 3);
    for (const r of related) {
      context_parts.push(`【相关经验】${r.trigger_condition}\n${r.steps.slice(0,3).join('\n')}`);
    }
  }

  // 4. 最近的 user/assistant 对话
  context_parts.push(format_recent_messages(session.messages, 10));

  // 5. 流式上下文：累积 chunks 和最终 response
  const chunks: string[] = [];
  let fullResponse: LLMResponse | null = null;

  return {
    messages: context_parts,
    appendAssistantChunk: (chunk: string) => chunks.push(chunk),
    finalizeStream: () => {
      fullResponse ??= { content: chunks.join(''), finish_reason: 'stop' };
      return fullResponse;
    },
    showNotification: (msg: string) => console.log(msg),
    finishAssistantMessage: (content: string) => {
      session.add_message({ role: 'assistant', content });
    },
  };
}
```

---

## 10. 错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| LLM API 错误 | 重试 3 次，指数退避，显示错误 |
| Tool 执行失败 | 返回错误信息给 LLM，让 LLM 决定如何处理 |
| Approval 超时 | 5 分钟超时，自动拒绝，提示用户 |
| Session 不存在 | 创建新 Session，提示用户 |
| 无效 Tool 调用 | 返回错误，不崩溃 |

---

## 11. 配置文件格式

```yaml
# Program/agent/config.yaml

provider: anthropic  # anthropic | openai

anthropic:
  api_key: ${ANTHROPIC_API_KEY}  # 环境变量引用
  model: claude-opus-4-6
  max_tokens: 8192

openai:
  api_key: ${OPENAI_API_KEY}
  base_url: https://api.openai.com/v1
  model: gpt-4o

tools:
  run_shell:
    allowed_commands:  # 白名单，可选
      - npm
      - git
      - node
      - yarn
    denied_patterns:   # 黑名单正则
      - ^rm\s+-rf
      - ^sudo

approval:
  auto_approve_safe: true   # safe 级别自动通过
  timeout_seconds: 300      # 5 分钟超时

session:
  max_history_tokens: 6000
  compress_threshold: 4500   # 超过此值开始压缩
```

---

## 12. 测试策略

```
tests/
├── llm/
│   ├── provider.test.ts      # Provider 抽象测试
│   ├── anthropic.test.ts     # Anthropic mock 测试
│   └── openai.test.ts        # OpenAI mock 测试
├── tools/
│   ├── registry.test.ts
│   ├── executor.test.ts      # 并行执行测试 + Zod 校验
│   ├── bash.test.ts
│   ├── read.test.ts
│   ├── edit.test.ts
│   ├── grep.test.ts
│   └── glob.test.ts
├── session/
│   ├── manager.test.ts       # 上下文截断测试
│   ├── context.test.ts       # 上下文构建管道测试
│   └── history.test.ts       # JSONL 持久化测试
├── skills/
│   ├── registry.test.ts      # 技能匹配（精确/模糊）测试
│   ├── patcher.test.ts       # 自动 patch 测试
│   └── reflection.test.ts    # 反思触发 + synthesis 测试
├── memory/
│   ├── storage.test.ts       # JSON 文件存储测试
│   └── retriever.test.ts     # 跨会话检索测试
├── repl/
│   ├── loop.test.ts          # 双状态机测试
│   ├── slash.test.ts         # 斜杠命令测试
│   └── executor.test.ts      # 并行执行测试
└── integration/
    └── full.test.ts          # 端到端 REPL + 自学习集成测试
```

- 使用 `viest` 作为测试框架
- LLM 调用使用 mock，不走真实 API
- Tool 测试使用临时文件和目录
