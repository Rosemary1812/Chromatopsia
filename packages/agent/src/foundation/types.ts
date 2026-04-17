// ============================================================
// Core Types for Chromatopsia Agent
// ============================================================

// --- Message & Conversation ---

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface Message {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  cache_control?: {
    type: 'ephemeral';
  };
  timestamp?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  success: boolean;
}

// --- Provider Protocol Abstraction ---

export type ProviderType =
  | 'anthropic'
  | 'claude'
  | 'openai'
  | 'openai-compatible'
  | 'codex';

export type ProviderFamily = 'anthropic' | 'openai';

// --- Tool System ---

export type DangerLevel = 'safe' | 'warning' | 'dangerous';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: object; // JSON Schema
  zod_schema?: unknown;  // z.ZodType, optional runtime validation
  handler: ToolHandler;
  danger_level?: DangerLevel;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolResult>;

export interface ToolContext {
  session: Session;
  working_directory: string;
}

// --- LLM Provider ---

export interface ChatRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  model?: string;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
  finish_reason: 'stop' | 'tool_use';
}

export interface StreamEventBase {
  type: 'text_delta' | 'reasoning_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end';
}

export interface TextDeltaStreamEvent extends StreamEventBase {
  type: 'text_delta';
  text: string;
}

export interface ReasoningDeltaStreamEvent extends StreamEventBase {
  type: 'reasoning_delta';
  text: string;
}

export interface ToolCallStartStreamEvent extends StreamEventBase {
  type: 'tool_call_start';
  tool_call: ToolCall;
}

export interface ToolCallDeltaStreamEvent extends StreamEventBase {
  type: 'tool_call_delta';
  tool_call_id: string;
  partial_json: string;
}

export interface ToolCallEndStreamEvent extends StreamEventBase {
  type: 'tool_call_end';
  tool_call: ToolCall;
}

export type StreamEvent =
  | TextDeltaStreamEvent
  | ReasoningDeltaStreamEvent
  | ToolCallStartStreamEvent
  | ToolCallDeltaStreamEvent
  | ToolCallEndStreamEvent;

export type LLMResponse = ChatResponse;

export interface ProviderConfig {
  api_key: string;
  base_url?: string;
  model?: string;
  max_tokens?: number;
  timeout?: number;
}

export interface StreamOptions {
  system_hint?: string;
  on_tool_call_start?: (tool_call: ToolCall) => void;
  on_tool_call_end?: (tool_call: ToolCall, result: ToolResult) => void;
}

export interface LLMProvider {
  name: string;
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;
  chat_stream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: StreamOptions,
  ): AsyncGenerator<string, LLMResponse, void>;
  get_model(): string;
}

// --- Session ---

export interface Session {
  id: string;
  messages: Message[];
  working_directory: string;
  project_context?: ProjectContext;
  user_context?: UserContext;
  created_at: number;
  last_active: number;

  add_message(message: Message): void;
  clear(): void;
  compact(): Promise<void>;
}

export interface ProjectContext {
  name: string;
  root: string;
  language?: string;
  framework?: string;
  description?: string;
}

export interface UserContext {
  name?: string;
  preferences?: Record<string, unknown>;
}

// --- Approval ---

export interface ApprovalRequest {
  id: string;
  tool_name: string;
  args: Record<string, unknown>;
  context: string;
  suggested_approval?: boolean;
  timestamp: number;
}

export type ApprovalDecision = 'approve' | 'reject' | 'edit';

export interface ApprovalResponse {
  request_id: string;
  decision: ApprovalDecision;
  modified_args?: Record<string, unknown>;
}

// --- Runtime Events ---

export type RuntimeAgentRole = 'main' | 'worker' | 'reviewer';

export interface RuntimeEventBase {
  agentId: string;
  agentRole?: RuntimeAgentRole;
  timestamp: number;
}

export interface RuntimeTurnStartedEvent extends RuntimeEventBase {
  type: 'turn_started';
  turnId: string;
  text: string;
}

export interface RuntimeAssistantChunkEvent extends RuntimeEventBase {
  type: 'assistant_chunk';
  turnId: string;
  chunk: string;
}

export interface RuntimeAssistantMessageEvent extends RuntimeEventBase {
  type: 'assistant_message';
  turnId: string;
  content: string;
  toolCalls?: ToolCall[];
}

export interface RuntimeToolStartedEvent extends RuntimeEventBase {
  type: 'tool_started';
  turnId: string;
  toolCall: ToolCall;
}

export interface RuntimeToolFinishedEvent extends RuntimeEventBase {
  type: 'tool_finished';
  turnId: string;
  toolCall: ToolCall;
  result: ToolResult;
}

export interface RuntimeToolBatchFinishedEvent extends RuntimeEventBase {
  type: 'tool_batch_finished';
  turnId: string;
  toolCalls: ToolCall[];
  results: ToolResult[];
}

export interface RuntimeApprovalRequestedEvent extends RuntimeEventBase {
  type: 'approval_requested';
  turnId: string;
  request: ApprovalRequest;
}

export interface RuntimeApprovalResolvedEvent extends RuntimeEventBase {
  type: 'approval_resolved';
  turnId: string;
  requestId: string;
  decision: ApprovalDecision;
}

export interface RuntimeNotificationEvent extends RuntimeEventBase {
  type: 'notification';
  message: string;
}

export interface RuntimeErrorEvent extends RuntimeEventBase {
  type: 'error';
  message: string;
}

export interface RuntimeDebugEvent extends RuntimeEventBase {
  type: 'debug';
  message: string;
}

export interface RuntimeTurnCompletedEvent extends RuntimeEventBase {
  type: 'turn_completed';
  turnId: string;
  content: string;
}

export type RuntimeEvent =
  | RuntimeTurnStartedEvent
  | RuntimeAssistantChunkEvent
  | RuntimeAssistantMessageEvent
  | RuntimeToolStartedEvent
  | RuntimeToolFinishedEvent
  | RuntimeToolBatchFinishedEvent
  | RuntimeApprovalRequestedEvent
  | RuntimeApprovalResolvedEvent
  | RuntimeNotificationEvent
  | RuntimeErrorEvent
  | RuntimeDebugEvent
  | RuntimeTurnCompletedEvent;

export interface RuntimeSink {
  emit: (event: RuntimeEvent) => void;
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
}

// --- Skill & Self-Learning ---

export interface Skill {
  id: string;
  name: string;
  trigger_condition: string;
  trigger_pattern?: string;
  steps: string[];
  pitfalls: string[];
  verification?: string;
  task_type: string;
  created_at: number;
  updated_at: number;
  call_count: number;
  success_count: number;
  is_stale?: boolean;
}

export type SkillScope = 'builtin' | 'user' | 'project' | 'learning_draft';

export interface SkillManifestEntry {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  trigger_pattern?: string;
  task_type: string;
  scope: SkillScope;
  enabled: boolean;
  priority: number;
  version: number;
  updated_at: string;
  source_path: string;
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryIndexEntry {
  name: string;
  file: string;
  description: string;
  type?: MemoryType;
  updated_at?: string;
}

export interface TaskBufferEntry {
  tool_calls: ToolCall[];
  tool_results: ToolResult[];
  task_type: string;
  session_id: string;
  timestamp: number;
}

export interface SynthesisResult {
  skill: Partial<Skill>;
  reasoning: string;
}

// --- REPL Context ---

export interface ReplContextValue {
  appendUserMessage: (text: string) => void;
  appendAssistantChunk: (chunk: string) => void;
  finishAssistantMessage: (fullContent: string) => void;
  appendToolResult: (result: ToolResult, toolName: string) => void;
  showApproval: (req: ApprovalRequest) => Promise<ApprovalResponse>;
  showNotification: (msg: string) => void;
}

export interface LLMContext {
  messages: Message[];
  appendAssistantChunk: (chunk: string) => void;
  setToolCalls: (tool_calls: ToolCall[]) => void;
  finalizeStream: () => LLMResponse;
  showNotification: (msg: string) => void;
  finishAssistantMessage: (content: string) => void;
}

// --- Compression ---

export interface CompressionMetadata {
  type: 'summarize' | 'truncate';
  original_count: number;
  preserved_count: number;
  compressed_at: number;
}

export interface CompressionConfig {
  compress_threshold: number;
  preserve_recent: number;
  min_summarizable: number;
}

// --- Config ---

export interface AppConfig {
  provider: ProviderType;
  anthropic?: {
    api_key: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  claude?: {
    api_key: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  openai?: {
    api_key: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  'openai-compatible'?: {
    api_key: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  codex?: {
    api_key: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  tools?: {
    run_shell?: {
      allowed_commands?: string[];
      denied_patterns?: string[];
    };
  };
  approval?: {
    auto_approve_safe?: boolean;
    timeout_seconds?: number;
  };
  storage?: {
    mode?: 'project' | 'home';
    root_dir?: string;
  };
  session?: {
    max_history_tokens?: number;
    compress_threshold?: number;
  };
  learning?: {
    enabled?: boolean;
    batch_turns?: number;
    min_confidence?: number;
    reminder?: {
      enabled?: boolean;
      max_per_session?: number;
    };
  };
}

export interface TurnEvent {
  id: string;
  session_id: string;
  timestamp: number;
  task_type: string;
  user_input: string;
}

// --- Agent Output Events (CLI/TUI implements these) ---

/**
 * 事件回调接口。CLI / TUI 实现这些来接管所有渲染输出。
 * Agent 本身是纯库，零 I/O。
 */
export interface AgentEvents {
  /** LLM stream 每个字符/片段。CLI 可直接 stdout.write(chunk) */
  onStreamChunk?: (chunk: string) => void;

  /** 危险工具请求审批，调用方必须返回审批决定 */
  onApprovalRequest?: (request: ApprovalRequest) => Promise<ApprovalResponse>;

  /** 本轮对话结束（所有 tool_calls 执行完毕后） */
  onTurnComplete?: (content: string, toolCalls?: ToolCall[]) => void;

  /** 单个工具开始执行 */
  onToolStart?: (toolCall: ToolCall) => void;

  /** 单个工具执行完毕 */
  onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;

  /** 所有工具执行完毕（tool loop 一轮结束） */
  onToolBatchEnd?: (toolCalls: ToolCall[], results: ToolResult[]) => void;

  /** 通知/提示信息（skill 命中、合成成功等） */
  onNotification?: (msg: string) => void;

  /** 错误 */
  onError?: (msg: string) => void;

  /** 调试信息（仅 logLevel='debug' 时有意义） */
  onDebug?: (msg: string) => void;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
