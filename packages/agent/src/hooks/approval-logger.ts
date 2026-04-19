/**
 * Approval Logger — 记录所有批准/拒绝决策
 * 用于 Evaluation 阶段验证安全机制的有效性
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export type ApprovalLogStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'auto_approved' | 'cancelled' | 'timed_out';

export interface ApprovalLog {
  timestamp: number;
  request_id: string;
  tool_name: string;
  danger_level: 'safe' | 'warning' | 'dangerous';
  status: ApprovalLogStatus;
  command?: string;  // 对于 run_shell
  approved?: boolean;
  decision_reason?: string;
  approval_wait_ms?: number;
  session_id: string;
}

export interface ApprovalStats {
  total_requests: number;
  pending_requests: number;
  approved: number;
  rejected: number;
  by_tool: Record<string, { total: number; approved: number; rejected: number; pending: number }>;
  by_danger_level: Record<string, { total: number; approved: number; rejected: number; pending: number }>;
}

export class ApprovalLogger {
  private logPath: string;

  constructor(logsDir: string) {
    this.logPath = path.join(logsDir, 'approvals.jsonl');
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.logPath);
    await fs.mkdir(dir, { recursive: true });
    // Create or append to file
    await fs.appendFile(this.logPath, '');
  }

  /**
   * 记录批准请求
   */
  async logApprovalRequest(log: ApprovalLog): Promise<void> {
    const line = JSON.stringify(log) + '\n';
    await fs.appendFile(this.logPath, line);
  }

  private normalizeLog(log: Partial<ApprovalLog>): ApprovalLog | null {
    if (
      typeof log.timestamp !== 'number'
      || typeof log.request_id !== 'string'
      || typeof log.tool_name !== 'string'
      || (log.danger_level !== 'safe' && log.danger_level !== 'warning' && log.danger_level !== 'dangerous')
      || typeof log.session_id !== 'string'
    ) {
      return null;
    }

    let status = log.status;
    if (!status) {
      if (log.decision_reason === 'pending_user_approval') {
        status = 'pending';
      } else if (log.decision_reason === 'auto_approved_safe') {
        status = 'auto_approved';
      } else if (log.decision_reason === 'user_edited') {
        status = 'edited';
      } else if (log.approved === true) {
        status = 'approved';
      } else {
        status = 'rejected';
      }
    }

    return {
      timestamp: log.timestamp,
      request_id: log.request_id,
      tool_name: log.tool_name,
      danger_level: log.danger_level,
      status,
      command: log.command,
      approved: log.approved,
      decision_reason: log.decision_reason,
      approval_wait_ms: log.approval_wait_ms,
      session_id: log.session_id,
    };
  }

  private getLatestLogs(logs: ApprovalLog[]): ApprovalLog[] {
    const latestByRequest = new Map<string, ApprovalLog>();
    for (const log of logs) {
      latestByRequest.set(log.request_id, log);
    }
    return [...latestByRequest.values()];
  }

  private isApprovedStatus(status: ApprovalLogStatus): boolean {
    return status === 'approved' || status === 'edited' || status === 'auto_approved';
  }

  private isRejectedStatus(status: ApprovalLogStatus): boolean {
    return status === 'rejected' || status === 'cancelled' || status === 'timed_out';
  }

  /**
   * 获取所有批准日志
   */
  async getAllLogs(): Promise<ApprovalLog[]> {
    try {
      const content = await fs.readFile(this.logPath, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return this.normalizeLog(JSON.parse(line) as Partial<ApprovalLog>);
          } catch {
            return null;
          }
        })
        .filter((log): log is ApprovalLog => log !== null);
    } catch {
      return [];
    }
  }

  /**
   * 获取统计数据
   */
  async getApprovalStats(): Promise<ApprovalStats> {
    const logs = this.getLatestLogs(await this.getAllLogs());

    const stats: ApprovalStats = {
      total_requests: 0,
      pending_requests: 0,
      approved: 0,
      rejected: 0,
      by_tool: {},
      by_danger_level: {},
    };

    for (const log of logs) {
      // Group by tool
      if (!stats.by_tool[log.tool_name]) {
        stats.by_tool[log.tool_name] = { total: 0, approved: 0, rejected: 0, pending: 0 };
      }
      if (log.status === 'pending') {
        stats.pending_requests++;
        stats.by_tool[log.tool_name].pending++;
      } else {
        stats.total_requests++;
        stats.by_tool[log.tool_name].total++;
      }
      if (this.isApprovedStatus(log.status)) {
        stats.approved++;
        stats.by_tool[log.tool_name].approved++;
      } else if (this.isRejectedStatus(log.status)) {
        stats.rejected++;
        stats.by_tool[log.tool_name].rejected++;
      }

      // Group by danger level
      if (!stats.by_danger_level[log.danger_level]) {
        stats.by_danger_level[log.danger_level] = { total: 0, approved: 0, rejected: 0, pending: 0 };
      }
      if (log.status === 'pending') {
        stats.by_danger_level[log.danger_level].pending++;
      } else {
        stats.by_danger_level[log.danger_level].total++;
      }
      if (this.isApprovedStatus(log.status)) {
        stats.by_danger_level[log.danger_level].approved++;
      } else if (this.isRejectedStatus(log.status)) {
        stats.by_danger_level[log.danger_level].rejected++;
      }
    }

    return stats;
  }

  /**
   * 获取特定工具的批准统计
   */
  async getToolStats(toolName: string): Promise<{ total: number; approved: number; rejected: number; pending: number; approvalRate: number } | null> {
    const stats = await this.getApprovalStats();
    const toolStats = stats.by_tool[toolName];
    if (!toolStats) return null;

    return {
      ...toolStats,
      approvalRate: toolStats.total > 0 ? toolStats.approved / toolStats.total : 0,
    };
  }

  /**
   * 获取被拒绝的请求
   */
  async getRejectedRequests(limit?: number): Promise<ApprovalLog[]> {
    const logs = this.getLatestLogs(await this.getAllLogs());
    const rejected = logs.filter(l => this.isRejectedStatus(l.status));
    return limit ? rejected.slice(-limit) : rejected;
  }

  /**
   * 获取危险工具被批准的请求
   */
  async getDangerousApprovals(): Promise<ApprovalLog[]> {
    const logs = this.getLatestLogs(await this.getAllLogs());
    return logs.filter(l => l.danger_level === 'dangerous' && this.isApprovedStatus(l.status));
  }
}
