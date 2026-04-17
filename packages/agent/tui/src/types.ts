import type {
  ApprovalRequest,
  RuntimeEvent,
  ToolCall,
  ToolResult,
} from "@chromatopsia/agent";

export type TuiInputMode = "normal" | "approval";
export type TuiThemeMode = "dark" | "light";

export interface TuiThemePalette {
  primary: string;
  highlightedText: string;
  textPrimary: string;
  textMuted: string;
  textDim: string;
  secondaryBackground: string;
  surfaceBorder: string;
  info: string;
  success: string;
  warning: string;
  danger: string;
  syntaxKeyword: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxTitle: string;
  syntaxLiteral: string;
  syntaxComment: string;
}

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
  themeMode: TuiThemeMode;
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
  setThemeMode: (mode: TuiThemeMode) => void;
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

export const DEFAULT_TUI_THEME_MODE: TuiThemeMode = "dark";

export const TUI_THEMES: Record<TuiThemeMode, TuiThemePalette> = {
  dark: {
    primary: "#c43a3a",
    highlightedText: "#ffd7d7",
    textPrimary: "#f5f7fa",
    textMuted: "#c8d0d8",
    textDim: "#8f99a3",
    secondaryBackground: "#171a1f",
    surfaceBorder: "#694343",
    info: "#58b0ff",
    success: "#42bf83",
    warning: "#d79a34",
    danger: "#ea6666",
    syntaxKeyword: "#ff9e64",
    syntaxString: "#9ece6a",
    syntaxNumber: "#e0af68",
    syntaxTitle: "#7aa2f7",
    syntaxLiteral: "#bb9af7",
    syntaxComment: "#6b7280",
  },
  light: {
    primary: "#a61b1b",
    highlightedText: "#7c1111",
    textPrimary: "#16181b",
    textMuted: "#4d5863",
    textDim: "#6f7a85",
    secondaryBackground: "#f2f4f7",
    surfaceBorder: "#d8b8b8",
    info: "#0f6cbd",
    success: "#1f8a4c",
    warning: "#9a6700",
    danger: "#c62828",
    syntaxKeyword: "#a2460f",
    syntaxString: "#2f7d32",
    syntaxNumber: "#9a5a13",
    syntaxTitle: "#2457c5",
    syntaxLiteral: "#7c3aed",
    syntaxComment: "#7a808a",
  },
} as const;

export const BRAND_LOGO = [" ▐▛███▜▌", " ███████", " ▋ ▋ ▐ ▐"] as const;

export function getTheme(mode: TuiThemeMode): TuiThemePalette {
  return TUI_THEMES[mode];
}

export function resolveThemeMode(value: string | undefined): TuiThemeMode {
  return value === "light" ? "light" : "dark";
}

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

export function getModeColor(
  mode: "idle" | "working" | "approval",
  theme: TuiThemePalette,
): string {
  switch (mode) {
    case "working":
      return theme.primary;
    case "approval":
      return theme.warning;
    default:
      return theme.textMuted;
  }
}

export function truncateMiddle(value: string, maxLength = 56): string {
  if (value.length <= maxLength) return value;
  const segment = Math.max(8, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, segment)}…${value.slice(-segment)}`;
}
