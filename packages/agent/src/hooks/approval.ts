// T-20: hooks/approval.ts Approval 机制
import { randomUUID } from 'crypto';
import type { ApprovalRequest, ApprovalResponse } from '../foundation/types.js';
import { registry } from '../foundation/tools/registry.js';
import { is_dangerous_command, is_sensitive_path } from '../foundation/tools/denied-patterns.js';

// ============================================================
// ApprovalHook
// ============================================================

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ApprovalHook {
  private pendingRequests = new Map<string, {
    resolve: (response: ApprovalResponse) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();

  /**
   * Request approval for a tool execution.
   *
   * @param tool_name - Name of the tool to execute
   * @param args - Tool arguments
   * @param context - Human-readable context description
   * @returns ApprovalRequest if approval is needed, null if auto-approved
   */
  request_approval(
    tool_name: string,
    args: Record<string, unknown>,
    context: string
  ): ApprovalRequest | null {
    const toolDef = registry.get(tool_name);

    // Unknown tools default to requiring approval
    if (!toolDef) {
      return this.createRequest(tool_name, args, context);
    }

    // Dangerous tools always require approval
    if (toolDef.danger_level === 'dangerous') {
      // Check for dangerous command patterns in arguments
      if (tool_name === 'run_shell') {
        const command = args['command'] as string;
        if (command && is_dangerous_command(command)) {
          return this.createRequest(tool_name, args, context);
        }
      }
      return this.createRequest(tool_name, args, context);
    }

    // Warning tools require approval in dangerous scenarios
    if (toolDef.danger_level === 'warning') {
      if (this.isWarningScenario(tool_name, args)) {
        return this.createRequest(tool_name, args, context);
      }
    }

    // Safe tools are auto-approved
    return null;
  }

  /**
   * Check if a warning-level tool is being used in a dangerous scenario.
   */
  private isWarningScenario(tool_name: string, args: Record<string, unknown>): boolean {
    switch (tool_name) {
      case 'Edit': {
        const file_path = args['file_path'] as string;
        const old_string = args['old_string'] as string | undefined;
        const new_string = args['new_string'] as string | undefined;

        // Edit on sensitive files
        if (file_path && is_sensitive_path(file_path)) {
          return true;
        }

        // Large changes: old_string + new_string together > 5 lines
        const oldLines = (old_string || '').split('\n').length;
        const newLines = (new_string || '').split('\n').length;
        if (oldLines + newLines > 5) {
          return true;
        }

        return false;
      }

      case 'run_shell': {
        const command = args['command'] as string;
        if (command && is_dangerous_command(command)) {
          return true;
        }
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Create an approval request.
   */
  private createRequest(
    tool_name: string,
    args: Record<string, unknown>,
    context: string
  ): ApprovalRequest {
    return {
      id: randomUUID(),
      tool_name,
      args,
      context,
      timestamp: Date.now(),
    };
  }

  /**
   * Wait for user decision on an approval request.
   * Times out after DEFAULT_TIMEOUT_MS (5 minutes) and returns a rejection.
   *
   * @param request_id - The ID of the approval request
   * @param timeout_ms - Optional custom timeout in milliseconds
   * @returns Promise<ApprovalResponse>
   */
  async wait_for_decision(
    request_id: string,
    timeout_ms: number = DEFAULT_TIMEOUT_MS
  ): Promise<ApprovalResponse> {
    return new Promise<ApprovalResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request_id);
        // Timeout → auto reject
        resolve({
          request_id,
          decision: 'reject',
        });
      }, timeout_ms);

      this.pendingRequests.set(request_id, {
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  /**
   * Submit a decision for a pending approval request.
   * Called by the UI when the user makes a decision.
   *
   * @param response - The approval response from the user
   */
  submit_decision(response: ApprovalResponse): void {
    const pending = this.pendingRequests.get(response.request_id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(response.request_id);
    pending.resolve(response);
  }

  /**
   * Cancel a pending approval request without decision.
   *
   * @param request_id - The ID of the approval request to cancel
   */
  cancel_request(request_id: string): void {
    const pending = this.pendingRequests.get(request_id);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(request_id);
      pending.reject(new Error('Approval request cancelled'));
    }
  }

  /**
   * Get the number of pending approval requests.
   */
  get pending_count(): number {
    return this.pendingRequests.size;
  }

  /**
   * Check if there are pending requests.
   */
  has_pending(): boolean {
    return this.pendingRequests.size > 0;
  }
}
