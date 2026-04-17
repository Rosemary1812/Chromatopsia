// T-20: hooks/approval.ts Approval 机制
import { randomUUID } from 'crypto';
import type { ApprovalRequest, ApprovalResponse } from '../foundation/types.js';
import { registry } from '../foundation/tools/registry.js';
import { is_dangerous_command, is_sensitive_path } from '../foundation/tools/denied-patterns.js';

// ============================================================
// ApprovalHook
// ============================================================

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SAFE_RUN_SHELL_PATTERNS: RegExp[] = [
  /^\s*pwd\s*$/i,
  /^\s*ls(?:\s|$)/i,
  /^\s*dir(?:\s|$)/i,
  /^\s*echo(?:\s|$)/i,
  /^\s*git\s+status(?:\s|$)/i,
  /^\s*git\s+log(?:\s|$)/i,
  /^\s*git\s+diff(?:\s|$)/i,
  /^\s*git\s+show(?:\s|$)/i,
  /^\s*git\s+branch(?:\s|$)/i,
  /^\s*rg(?:\s|$)/i,
  /^\s*grep(?:\s|$)/i,
  /^\s*cat(?:\s|$)/i,
  /^\s*sed(?:\s|$)/i,
  /^\s*head(?:\s|$)/i,
  /^\s*tail(?:\s|$)/i,
  /^\s*wc(?:\s|$)/i,
  /^\s*find(?:\s|$)/i,
  /^\s*which(?:\s|$)/i,
  /^\s*where(?:\s|$)/i,
  /^\s*type(?:\s|$)/i,
  /^\s*tree(?:\s|$)/i,
];
const APPROVAL_RUN_SHELL_PATTERNS: RegExp[] = [
  /^\s*git\s+(?:push|commit|merge|rebase|cherry-pick|switch|checkout|reset|tag|fetch|pull)(?:\s|$)/i,
  /^\s*(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade|unlink|link|publish|login|logout|run|exec|dlx)(?:\s|$)/i,
  /^\s*(?:node|nodejs|python|python3|bash|sh|zsh|cmd|powershell|pwsh)(?:\s|$)/i,
  /^\s*(?:curl|wget)(?:\s|$)/i,
  /^\s*chmod(?:\s|$)/i,
  /^\s*chown(?:\s|$)/i,
  /^\s*mv(?:\s|$)/i,
  /^\s*cp(?:\s|$)/i,
  /^\s*mkdir(?:\s|$)/i,
  /^\s*touch(?:\s|$)/i,
  /^\s*tee(?:\s|$)/i,
  /^\s*docker(?:\s|$)/i,
];
const SHELL_CONTROL_OPERATOR_PATTERN = /[|;&><`]/;
const SHELL_EXPANSION_PATTERN = /\$\(|\${|\$[A-Za-z_]/;

export interface ApprovalHookOptions {
  auto_approve_safe?: boolean;
  timeout_ms?: number;
}

export class ApprovalHook {
  private pendingRequests = new Map<string, {
    resolve: (response: ApprovalResponse) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();
  private readonly autoApproveSafe: boolean;
  private readonly defaultTimeoutMs: number;

  constructor(options: ApprovalHookOptions = {}) {
    this.autoApproveSafe = options.auto_approve_safe ?? true;
    this.defaultTimeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  }

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

    if (tool_name === 'run_shell') {
      const command = typeof args['command'] === 'string' ? args['command'] : '';
      if (this.shouldApproveRunShell(command)) {
        return this.createRequest(tool_name, args, context);
      }
      return this.autoApproveSafe ? null : this.createRequest(tool_name, args, context);
    }

    // Dangerous tools always require approval
    if (toolDef.danger_level === 'dangerous') {
      return this.createRequest(tool_name, args, context);
    }

    // Warning tools require approval in dangerous scenarios
    if (toolDef.danger_level === 'warning') {
      if (this.isWarningScenario(tool_name, args)) {
        return this.createRequest(tool_name, args, context);
      }
    }

    // Safe tools are auto-approved
    return this.autoApproveSafe ? null : this.createRequest(tool_name, args, context);
  }

  private shouldApproveRunShell(command: string): boolean {
    const normalized = command.trim();
    if (!normalized) {
      return true;
    }

    if (is_dangerous_command(normalized)) {
      return true;
    }

    if (APPROVAL_RUN_SHELL_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return true;
    }

    if (SHELL_CONTROL_OPERATOR_PATTERN.test(normalized)) {
      return true;
    }

    if (SHELL_EXPANSION_PATTERN.test(normalized)) {
      return true;
    }

    return !SAFE_RUN_SHELL_PATTERNS.some((pattern) => pattern.test(normalized));
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
        return this.shouldApproveRunShell(command || '');
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
    timeout_ms: number = this.defaultTimeoutMs
  ): Promise<ApprovalResponse> {
    return new Promise<ApprovalResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request_id);
        // Timeout -> auto reject
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
