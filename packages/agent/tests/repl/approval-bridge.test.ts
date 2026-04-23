import { describe, expect, it, vi } from 'vitest';
import { createApprovalRequestHandler } from '../../src/repl/approval-bridge.js';
import type { ApprovalRequest, RuntimeSink } from '../../src/foundation/types.js';
import type { ApprovalHook } from '../../src/hooks/approval.js';

function createRequest(): ApprovalRequest {
  return {
    id: 'req-1',
    tool_name: 'run_shell',
    args: { command: 'pwd' },
    context: 'tool execution',
    timestamp: Date.now(),
  };
}

describe('repl/approval-bridge', () => {
  it('prefers runtime approval handler and emits request/resolution events', async () => {
    const emitRuntime = vi.fn();
    const runtime: RuntimeSink = {
      emit: vi.fn(),
      requestApproval: vi.fn(async (request) => ({
        request_id: request.id,
        decision: 'approve',
      })),
    };
    const approvalHook = {
      wait_for_decision: vi.fn(),
      submit_decision: vi.fn(),
    } as unknown as ApprovalHook;

    const handler = createApprovalRequestHandler({
      runtime,
      approvalHook,
      emitRuntime,
      turnId: 'turn-1',
    });

    const decision = await handler(createRequest());

    expect(decision.decision).toBe('approve');
    expect(runtime.requestApproval).toHaveBeenCalledTimes(1);
    expect(approvalHook.wait_for_decision).not.toHaveBeenCalled();
    expect(emitRuntime).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'approval_requested',
      turnId: 'turn-1',
    }));
    expect(emitRuntime).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'approval_resolved',
      turnId: 'turn-1',
      requestId: 'req-1',
      decision: 'approve',
    }));
  });

  it('falls back to ApprovalHook when runtime approval handler is absent', async () => {
    const emitRuntime = vi.fn();
    const runtime: RuntimeSink = {
      emit: vi.fn(),
    };
    const approvalHook = {
      wait_for_decision: vi.fn(async (requestId: string) => ({
        request_id: requestId,
        decision: 'reject' as const,
      })),
    } as unknown as ApprovalHook;

    const handler = createApprovalRequestHandler({
      runtime,
      approvalHook,
      emitRuntime,
      turnId: 'turn-2',
    });

    const decision = await handler(createRequest());

    expect(decision.decision).toBe('reject');
    expect(approvalHook.wait_for_decision).toHaveBeenCalledWith('req-1');
    expect(emitRuntime).toHaveBeenCalledTimes(2);
  });
});
