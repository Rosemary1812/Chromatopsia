import type {
  ApprovalRequest,
  RuntimeEvent,
  ToolCall,
  ToolResult,
} from "@chromatopsia/agent";

export type TuiInputMode = "normal" | "approval";

export type TranscriptItem =
  | {
      id: string;
      kind: "user";
      text: string;
      timestamp: number;
      turnId?: string;
      agentId?: string;
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      timestamp: number;
      turnId?: string;
      agentId?: string;
      streaming?: boolean;
      toolCalls?: ToolCall[];
    }
  | {
      id: string;
      kind: "tool";
      name: string;
      timestamp: number;
      turnId?: string;
      agentId?: string;
      status: "running" | "success" | "error";
      summary?: string;
      toolCall: ToolCall;
      result?: ToolResult;
    }
  | {
      id: string;
      kind: "notification";
      text: string;
      timestamp: number;
      agentId?: string;
      level: "info" | "error";
    }
  | {
      id: string;
      kind: "command_help";
      text: string;
      timestamp: number;
    };

export interface ToolActivityState {
  toolCall: ToolCall;
  status: "running" | "success" | "error";
  result?: ToolResult;
  summary?: string;
  turnId?: string;
  timestamp: number;
}

export interface TuiState {
  transcript: TranscriptItem[];
  inputMode: TuiInputMode;
  currentTurnId: string | null;
  streaming: boolean;
  approvalRequest: ApprovalRequest | null;
  pendingInput: string;
  notifications: Array<{
    id: string;
    text: string;
    level: "info" | "error";
    timestamp: number;
  }>;
  lastError: string | null;
  toolActivity: Record<string, ToolActivityState>;
  commandHelpVisible: boolean;
}

export interface TuiCommandContext {
  clearConversation?: () => void | Promise<void>;
  exit?: () => void | Promise<void>;
}

export interface BuiltinCommand {
  name: string;
  description: string;
  execute: (
    store: TuiStoreLike,
    context?: TuiCommandContext,
  ) => Promise<void> | void;
}

export interface TuiStoreLike {
  getState: () => TuiState;
  setPendingInput: (value: string) => void;
  clearTranscript: () => void;
  appendCommandHelp: () => void;
  hideCommandHelp: () => void;
}

export interface TuiCommandMatch {
  command: BuiltinCommand;
  raw: string;
}

export interface TuiStoreOptions extends TuiCommandContext {
  initialState?: Partial<TuiState>;
  summarizeToolResult?: (
    toolCall: ToolCall,
    result: ToolResult,
  ) => string | undefined;
}

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

// 先把主题常量收敛在类型文件里，方便当前这版 TUI 组件直接复用同一套色阶。
export const TUI_THEME = {
  primary: "#b01e1e",
  highlightedText: "#c6e7ff",
  textPrimary: "#f6f3f8",
  textMuted: "#aab4be",
  textDim: "#7f8b96",
  secondaryBackground: "#1d2630",
  surfaceBorder: "#5f5268",
  info: "#7ec8ff",
  success: "#7dd3a7",
  warning: "#f6c177",
  danger: "#ef8891",
} as const;

export const BRAND_LOGO = [" ▐▛███▜▌", " ███████", " ▋ ▋ ▋ ▐"] as const;

export function getModeLabel(mode: "idle" | "working" | "approval"): string {
  switch (mode) {
    case "working":
      return "Working";
    case "approval":
      return "Awaiting approval";
    default:
      return "Ready";
  }
}

export function getModeColor(mode: "idle" | "working" | "approval"): string {
  switch (mode) {
    case "working":
      return TUI_THEME.primary;
    case "approval":
      return TUI_THEME.warning;
    default:
      return TUI_THEME.textMuted;
  }
}

export function truncateMiddle(value: string, maxLength = 56): string {
  // 目录通常很长，Header 里保留首尾信息比简单截断更有辨识度。
  if (value.length <= maxLength) return value;
  const segment = Math.max(8, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, segment)}…${value.slice(-segment)}`;
}
