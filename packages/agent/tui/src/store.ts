import type { ApprovalResponse, RuntimeEvent, ToolCall, ToolResult } from '@chromatopsia/agent';
import { executeBuiltinCommand, formatBuiltinCommandHelp, listBuiltinCommands } from './commands.js';
import { summarizeToolResult as defaultSummarizeToolResult } from './summarize.js';
import type {
  TuiThemeMode,
  RuntimeEventHandler,
  TranscriptItem,
  TuiState,
  TuiStoreLike,
  TuiStoreOptions,
} from './types.js';
import { DEFAULT_TUI_THEME_MODE } from './types.js';

function createInitialState(initialState?: Partial<TuiState>): TuiState {
  return {
    transcript: [],
    inputMode: 'normal',
    themeMode: DEFAULT_TUI_THEME_MODE,
    currentTurnId: null,
    streaming: false,
    approvalRequest: null,
    pendingInput: '',
    notifications: [],
    lastError: null,
    toolActivity: {},
    commandHelpVisible: false,
    ...initialState,
  };
}

export class TuiStore implements TuiStoreLike {
  private state: TuiState;
  private readonly clearConversation?: () => void | Promise<void>;
  private readonly exit?: () => void | Promise<void>;
  private readonly summarizeToolResult: (toolCall: ToolCall, result: ToolResult) => string | undefined;
  private itemCounter = 0;
  private listeners = new Set<() => void>();

  constructor(options: TuiStoreOptions = {}) {
    this.state = createInitialState(options.initialState);
    this.clearConversation = options.clearConversation;
    this.exit = options.exit;
    this.summarizeToolResult = options.summarizeToolResult ?? defaultSummarizeToolResult;
  }

  getState(): TuiState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setPendingInput(value: string): void {
    this.state = {
      ...this.state,
      pendingInput: value,
    };
    this.emitChange();
  }

  setThemeMode(mode: TuiThemeMode): void {
    if (this.state.themeMode === mode) return;
    this.state = {
      ...this.state,
      themeMode: mode,
    };
    this.emitChange();
  }

  clearTranscript(): void {
    this.state = {
      ...this.state,
      transcript: [],
      currentTurnId: null,
      streaming: false,
      approvalRequest: null,
      inputMode: 'normal',
      notifications: [],
      lastError: null,
      toolActivity: {},
    };
    this.emitChange();
  }

  appendCommandHelp(): void {
    const helpText = formatBuiltinCommandHelp(listBuiltinCommands());
    this.state = {
      ...this.state,
      commandHelpVisible: true,
      transcript: [
        ...this.state.transcript,
        {
          id: this.nextId('command-help'),
          kind: 'command_help',
          text: helpText,
          timestamp: Date.now(),
        },
      ],
    };
    this.emitChange();
  }

  hideCommandHelp(): void {
    this.state = {
      ...this.state,
      commandHelpVisible: false,
    };
    this.emitChange();
  }

  async executeInput(input: string): Promise<{ handled: boolean }> {
    const handled = await executeBuiltinCommand(input, this, {
      clearConversation: this.clearConversation,
      exit: this.exit,
    });
    return { handled };
  }

  handleRuntimeEvent: RuntimeEventHandler = (event: RuntimeEvent) => {
    switch (event.type) {
      case 'turn_started':
        this.state = {
          ...this.state,
          currentTurnId: event.turnId,
          streaming: true,
          transcript: [
            ...this.state.transcript,
            {
              id: this.nextId('user'),
              kind: 'user',
              text: event.text,
              timestamp: event.timestamp,
              turnId: event.turnId,
              agentId: event.agentId,
            },
          ],
        };
        break;
      case 'assistant_chunk':
        this.upsertAssistantChunk(event.turnId, event.chunk, event.timestamp, event.agentId);
        break;
      case 'assistant_message':
        this.finalizeAssistantMessage(event.turnId, event.content, event.timestamp, event.agentId, event.toolCalls);
        break;
      case 'tool_started':
        this.upsertToolItem(event.turnId, event.toolCall, 'running', undefined, event.timestamp, event.agentId);
        break;
      case 'tool_finished': {
        const summary = this.summarizeToolResult(event.toolCall, event.result);
        this.upsertToolItem(
          event.turnId,
          event.toolCall,
          event.result.success ? 'success' : 'error',
          { result: event.result, summary },
          event.timestamp,
          event.agentId,
        );
        break;
      }
      case 'tool_batch_finished':
        break;
      case 'approval_requested':
        this.state = {
          ...this.state,
          approvalRequest: event.request,
          inputMode: 'approval',
        };
        break;
      case 'approval_resolved':
        this.state = {
          ...this.state,
          approvalRequest: null,
          inputMode: 'normal',
        };
        break;
      case 'notification':
        this.appendNotification(event.message, 'info', event.timestamp, event.agentId);
        break;
      case 'error':
        this.appendNotification(event.message, 'error', event.timestamp, event.agentId);
        this.state = {
          ...this.state,
          lastError: event.message,
        };
        break;
      case 'debug':
        break;
      case 'turn_completed':
        this.state = {
          ...this.state,
          currentTurnId: this.state.currentTurnId === event.turnId ? null : this.state.currentTurnId,
          streaming: false,
        };
        break;
    }
    this.emitChange();
  };

  createApprovalResponse(decision: ApprovalResponse['decision']): ApprovalResponse {
    const request = this.state.approvalRequest;
    if (!request) {
      throw new Error('No approval request pending');
    }
    return {
      request_id: request.id,
      decision,
    };
  }

  private appendNotification(
    text: string,
    level: 'info' | 'error',
    timestamp: number,
    agentId?: string,
  ): void {
    const item: TranscriptItem = {
      id: this.nextId(`notification-${level}`),
      kind: 'notification',
      text,
      level,
      timestamp,
      agentId,
    };

    this.state = {
      ...this.state,
      transcript: [...this.state.transcript, item],
      notifications: [
        ...this.state.notifications,
        { id: item.id, text, level, timestamp },
      ],
    };
  }

  private upsertAssistantChunk(turnId: string, chunk: string, timestamp: number, agentId?: string): void {
    const transcript = [...this.state.transcript];
    const index = this.findAssistantIndex(turnId);
    if (index >= 0) {
      const existing = transcript[index];
      if (existing.kind === 'assistant') {
        transcript[index] = {
          ...existing,
          text: `${existing.text}${chunk}`,
          streaming: true,
        };
      }
    } else {
      transcript.push({
        id: this.nextId('assistant'),
        kind: 'assistant',
        text: chunk,
        timestamp,
        turnId,
        agentId,
        streaming: true,
      });
    }

    this.state = {
      ...this.state,
      transcript,
      streaming: true,
      currentTurnId: turnId,
    };
  }

  private finalizeAssistantMessage(
    turnId: string,
    content: string,
    timestamp: number,
    agentId?: string,
    toolCalls?: ToolCall[],
  ): void {
    const transcript = [...this.state.transcript];
    const index = this.findAssistantIndex(turnId);
    const item: TranscriptItem = {
      id: index >= 0 ? transcript[index].id : this.nextId('assistant'),
      kind: 'assistant',
      text: content,
      timestamp,
      turnId,
      agentId,
      streaming: false,
      toolCalls,
    };

    if (index >= 0) {
      transcript[index] = item;
    } else {
      transcript.push(item);
    }

    this.state = {
      ...this.state,
      transcript,
    };
  }

  private upsertToolItem(
    turnId: string,
    toolCall: ToolCall,
    status: 'running' | 'success' | 'error',
    extra: { result?: ToolResult; summary?: string } | undefined,
    timestamp: number,
    agentId?: string,
  ): void {
    const transcript = [...this.state.transcript];
    const existingIndex = transcript.findIndex(
      (item) => item.kind === 'tool' && item.toolCall.id === toolCall.id,
    );

    const nextItem: TranscriptItem = {
      id: existingIndex >= 0 ? transcript[existingIndex].id : this.nextId('tool'),
      kind: 'tool',
      name: toolCall.name,
      timestamp,
      turnId,
      agentId,
      status,
      summary: extra?.summary,
      toolCall,
      result: extra?.result,
    };

    if (existingIndex >= 0) {
      transcript[existingIndex] = nextItem;
    } else {
      transcript.push(nextItem);
    }

    this.state = {
      ...this.state,
      transcript,
      toolActivity: {
        ...this.state.toolActivity,
        [toolCall.id]: {
          toolCall,
          status,
          result: extra?.result,
          summary: extra?.summary,
          turnId,
          timestamp,
        },
      },
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private findAssistantIndex(turnId: string): number {
    for (let index = this.state.transcript.length - 1; index >= 0; index -= 1) {
      const item = this.state.transcript[index];
      if (item.kind === 'assistant' && item.turnId === turnId) {
        return index;
      }
    }
    return -1;
  }

  private nextId(prefix: string): string {
    this.itemCounter += 1;
    return `${prefix}-${this.itemCounter}`;
  }
}
