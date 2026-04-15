import type {
  AgentEvents,
  ApprovalRequest,
  ApprovalResponse,
  RuntimeAgentRole,
  RuntimeEvent,
  RuntimeSink,
  ToolCall,
} from '../foundation/types.js';

export interface RuntimeMetadata {
  agentId: string;
  agentRole?: RuntimeAgentRole;
}

export type RuntimeEventInput =
  RuntimeEvent extends infer T
    ? T extends RuntimeEvent
      ? Omit<T, 'agentId' | 'agentRole' | 'timestamp'>
      : never
    : never;

export function createRuntimeEvent(
  event: RuntimeEventInput,
  metadata: RuntimeMetadata,
): RuntimeEvent {
  return {
    ...event,
    agentId: metadata.agentId,
    agentRole: metadata.agentRole,
    timestamp: Date.now(),
  } as RuntimeEvent;
}

export function createRuntimeSinkFromAgentEvents(
  events: AgentEvents = {},
): RuntimeSink {
  const lastToolCallsByTurn = new Map<string, ToolCall[] | undefined>();

  return {
    emit(event) {
      switch (event.type) {
        case 'assistant_chunk':
          events.onStreamChunk?.(event.chunk);
          break;
        case 'assistant_message':
          if (event.toolCalls) {
            lastToolCallsByTurn.set(event.turnId, event.toolCalls);
          }
          break;
        case 'tool_started':
          events.onToolStart?.(event.toolCall);
          break;
        case 'tool_finished':
          events.onToolEnd?.(event.toolCall, event.result);
          break;
        case 'tool_batch_finished':
          events.onToolBatchEnd?.(event.toolCalls, event.results);
          break;
        case 'notification':
          events.onNotification?.(event.message);
          break;
        case 'error':
          events.onError?.(event.message);
          break;
        case 'debug':
          events.onDebug?.(event.message);
          break;
        case 'turn_completed': {
          const toolCalls = lastToolCallsByTurn.get(event.turnId);
          events.onTurnComplete?.(event.content, toolCalls);
          lastToolCallsByTurn.delete(event.turnId);
          break;
        }
        default:
          break;
      }
    },
    async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
      if (events.onApprovalRequest) {
        return events.onApprovalRequest(request);
      }
      return {
        request_id: request.id,
        decision: 'reject',
      };
    },
  };
}
