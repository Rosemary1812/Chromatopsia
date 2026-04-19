// T-20: hooks/approval.ts Approval 机制
import { randomUUID } from 'crypto';
import type { ApprovalRequest, ApprovalResponse } from '../foundation/types.js';
import { registry } from '../foundation/tools/registry.js';
import { is_dangerous_command, is_sensitive_path } from '../foundation/tools/denied-patterns.js';
import { ApprovalLogger } from './approval-logger.js';
import type { ApprovalLogStatus } from './approval-logger.js';

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

interface ApprovalAuditMetadata {
  request_id: string;
  tool_name: string;
  danger_level: 'safe' | 'warning' | 'dangerous';
  command?: string;
  session_id: string;
  requested_at: number;
}

export interface ApprovalHookOptions {
  auto_approve_safe?: boolean;
  timeout_ms?: number;
  logsDir?: string;  // 新增：用于初始化 ApprovalLogger
}

export class ApprovalHook {
  private pendingRequests = new Map<string, {
    resolve: (response: ApprovalResponse) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();
  private readonly autoApproveSafe: boolean;
  private readonly defaultTimeoutMs: number;
  private logger?: ApprovalLogger;  // 新增：日志记录器
  private auditMetadata = new Map<string, ApprovalAuditMetadata>();

  constructor(options: ApprovalHookOptions = {}) {
    this.autoApproveSafe = options.auto_approve_safe ?? true;
    this.defaultTimeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    if (options.logsDir) {
      this.logger = new ApprovalLogger(options.logsDir);
      // 异步初始化，不阻塞构造
      this.logger.init().catch(err => {
        console.error('[ApprovalLogger] Failed to init:', err);
      });
    }
  }

  /**
   * Request approval for a tool execution.
   *
   * @param tool_name - Name of the tool to execute
   * @param args - Tool arguments
   * @param context - Human-readable context description
   * @param sessionId - Session ID for audit trail
   * @returns ApprovalRequest if approval is needed, null if auto-approved
   */
  request_approval(
    tool_name: string,
    args: Record<string, unknown>,
    context: string,
    sessionId?: string
  ): ApprovalRequest | null {
    const toolDef = registry.get(tool_name);

    // Unknown tools default to requiring approval
    if (!toolDef) {
      const request = this.createRequest(tool_name, args, context);
      this.logRequest(request, 'warning', args, sessionId);
      return request;
    }

    if (tool_name === 'run_shell') {
      const command = typeof args['command'] === 'string' ? args['command'] : '';
      if (this.shouldApproveRunShell(command)) {
        const request = this.createRequest(tool_name, args, context);
        this.logRequest(request, toolDef.danger_level ?? 'warning', args, sessionId);
        return request;
      }
      if (!this.autoApproveSafe) {
        const request = this.createRequest(tool_name, args, context);
        this.logRequest(request, toolDef.danger_level ?? 'warning', args, sessionId);
        return request;
      }
      // Auto-approve safe commands
      this.logApproval(tool_name, 'auto_approved', true, 'auto_approved_safe', args, sessionId);
      return null;
    }

    // Dangerous tools always require approval
    if (toolDef.danger_level === 'dangerous') {
      const request = this.createRequest(tool_name, args, context);
      this.logRequest(request, 'dangerous', args, sessionId);
      return request;
    }

    // Warning tools require approval in dangerous scenarios
    if (toolDef.danger_level === 'warning') {
      if (this.isWarningScenario(tool_name, args)) {
        const request = this.createRequest(tool_name, args, context);
        this.logRequest(request, 'warning', args, sessionId);
        return request;
      }
    }

    // Safe tools are auto-approved
    if (this.autoApproveSafe) {
      this.logApproval(tool_name, 'auto_approved', true, 'auto_approved_safe', args, sessionId);
      return null;
    }

    const request = this.createRequest(tool_name, args, context);
    this.logRequest(request, toolDef.danger_level ?? 'safe', args, sessionId);
    return request;
  }

  /**
   * 记录需要批准的请求（后台异步）
   */
  private logRequest(
    request: ApprovalRequest,
    dangerLevel: 'safe' | 'warning' | 'dangerous',
    args: Record<string, unknown>,
    sessionId?: string
  ): void {
    const metadata: ApprovalAuditMetadata = {
      request_id: request.id,
      tool_name: request.tool_name,
      danger_level: dangerLevel,
      command: request.tool_name === 'run_shell' ? (args['command'] as string | undefined) : undefined,
      session_id: sessionId ?? 'unknown',
      requested_at: request.timestamp,
    };
    this.auditMetadata.set(request.id, metadata);

    if (!this.logger) return;

    // 后台异步记录，不阻塞主流程
    this.logger.logApprovalRequest({
      timestamp: Date.now(),
      request_id: request.id,
      tool_name: request.tool_name,
      danger_level: dangerLevel,
      status: 'pending',
      command: metadata.command,
      decision_reason: 'pending_user_approval',
      session_id: metadata.session_id,
    }).catch(err => {
      console.error('[ApprovalLogger] Failed to log request:', err);
    });
  }

  /**
   * 记录自动批准（后台异步）
   */
  private logApproval(
    toolName: string,
    status: 'auto_approved' | 'approved' | 'edited' | 'rejected' | 'cancelled' | 'timed_out',
    approved: boolean,
    reason: string,
    args: Record<string, unknown>,
    sessionId?: string
  ): void {
    if (!this.logger) return;

    // 获取 tool 的 danger level
    const toolDef = registry.get(toolName);
    const dangerLevel = toolDef?.danger_level ?? 'safe';

    // 后台异步记录
    this.logger.logApprovalRequest({
      timestamp: Date.now(),
      request_id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool_name: toolName,
      danger_level: dangerLevel,
      status,
      command: toolName === 'run_shell' ? (args['command'] as string | undefined) : undefined,
      approved,
      decision_reason: reason,
      session_id: sessionId ?? 'unknown',
    }).catch(err => {
      console.error('[ApprovalLogger] Failed to log approval:', err);
    });
  }

  private logResolvedDecision(
    requestId: string,
    status: ApprovalLogStatus,
    decisionReason: string,
    sessionId?: string,
    modifiedArgs?: Record<string, unknown>
  ): void {
    const metadata = this.auditMetadata.get(requestId);
    if (!this.logger || !metadata) {
      return;
    }

    const approved = status === 'approved' || status === 'edited' || status === 'auto_approved';
    const command = metadata.tool_name === 'run_shell'
      ? (modifiedArgs?.['command'] as string | undefined) ?? metadata.command
      : metadata.command;

    this.logger.logApprovalRequest({
      timestamp: Date.now(),
      request_id: requestId,
      tool_name: metadata.tool_name,
      danger_level: metadata.danger_level,
      status,
      command,
      approved,
      decision_reason: decisionReason,
      approval_wait_ms: Date.now() - metadata.requested_at,
      session_id: sessionId ?? metadata.session_id,
    }).catch(err => {
      console.error('[ApprovalLogger] Failed to log decision:', err);
    });

    this.auditMetadata.delete(requestId);
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
        this.logResolvedDecision(request_id, 'timed_out', 'approval_timed_out');
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
   * @param sessionId - Session ID for audit trail
   */
  submit_decision(response: ApprovalResponse, sessionId?: string): void {
    const pending = this.pendingRequests.get(response.request_id);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(response.request_id);
    }

    const status = response.decision === 'approve'
      ? 'approved'
      : response.decision === 'edit'
        ? 'edited'
        : 'rejected';
    const reason = response.decision === 'approve'
      ? 'user_approved'
      : response.decision === 'edit'
        ? 'user_edited'
        : 'user_rejected';
    this.logResolvedDecision(response.request_id, status, reason, sessionId, response.modified_args);

    if (pending) {
      pending.resolve(response);
    }
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
      this.logResolvedDecision(request_id, 'cancelled', 'approval_cancelled');
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
