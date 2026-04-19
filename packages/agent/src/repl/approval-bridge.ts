import type { ApprovalRequestHandler } from '../foundation/tools/executor.js';
import type { RuntimeSink } from '../foundation/types.js';
import type { ApprovalHook } from '../hooks/approval.js';
import type { RuntimeEventInput } from './runtime.js';

export interface ApprovalBridgeOptions {
  runtime: RuntimeSink;
  approvalHook: ApprovalHook;
  emitRuntime: (event: RuntimeEventInput) => void;
  turnId: string;
}

export function createApprovalRequestHandler(
  options: ApprovalBridgeOptions,
): ApprovalRequestHandler {
  const {
    runtime,
    approvalHook,
    emitRuntime,
    turnId,
  } = options;

  return async (request) => {
    emitRuntime({ type: 'approval_requested', turnId, request });
    const decision = runtime.requestApproval
      ? await runtime.requestApproval(request)
      : await approvalHook.wait_for_decision(request.id);

    if (runtime.requestApproval) {
      approvalHook.submit_decision(decision);
    }

    emitRuntime({ type: 'approval_resolved', turnId, requestId: request.id, decision: decision.decision });
    return decision;
  };
}
