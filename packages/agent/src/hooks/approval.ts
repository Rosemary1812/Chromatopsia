// Placeholder - to be implemented in Phase 4
import type { ApprovalRequest, ApprovalResponse } from '../types.js';

export class ApprovalHook {
  request_approval(_tool_name: string, _args: Record<string, unknown>, _context: string): ApprovalRequest | null {
    return null; // Not implemented yet
  }

  async wait_for_decision(_request_id: string): Promise<ApprovalResponse> {
    throw new Error('Not implemented yet');
  }
}
