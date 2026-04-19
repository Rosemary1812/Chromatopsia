/**
 * tests/hooks/approval-logger.test.ts — Approval Logger Tests
 * P0-4 的测试覆盖
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApprovalLogger } from '../../src/hooks/approval-logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('ApprovalLogger (P0-4)', () => {
  let tempDir: string;
  let logger: ApprovalLogger;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-logger-test-'));
    logger = new ApprovalLogger(tempDir);
    await logger.init();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('logging approval requests', () => {
    it('should log a dangerous pending tool request', async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-1',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'pending',
        command: 'rm -rf /',
        decision_reason: 'pending_user_approval',
        session_id: 'session-1',
      });

      const logs = await logger.getAllLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].tool_name).toBe('run_shell');
      expect(logs[0].status).toBe('pending');
    });

    it('should log an auto-approved safe command', async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-2',
        tool_name: 'run_shell',
        danger_level: 'safe',
        status: 'auto_approved',
        command: 'pwd',
        approved: true,
        decision_reason: 'auto_approved_safe',
        session_id: 'session-1',
      });

      const logs = await logger.getAllLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('auto_approved');
      expect(logs[0].approved).toBe(true);
    });
  });

  describe('approval statistics', () => {
    beforeEach(async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-1',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'approved',
        approved: true,
        session_id: 'session-1',
      });

      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-2',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'rejected',
        approved: false,
        session_id: 'session-1',
      });

      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-3',
        tool_name: 'edit',
        danger_level: 'warning',
        status: 'auto_approved',
        approved: true,
        session_id: 'session-1',
      });
    });

    it('should calculate total approval statistics', async () => {
      const stats = await logger.getApprovalStats();

      expect(stats.total_requests).toBe(3);
      expect(stats.pending_requests).toBe(0);
      expect(stats.approved).toBe(2);
      expect(stats.rejected).toBe(1);
    });

    it('should calculate statistics by tool', async () => {
      const stats = await logger.getApprovalStats();

      expect(stats.by_tool['run_shell']).toBeDefined();
      expect(stats.by_tool['run_shell'].total).toBe(2);
      expect(stats.by_tool['run_shell'].approved).toBe(1);
      expect(stats.by_tool['run_shell'].rejected).toBe(1);
      expect(stats.by_tool['run_shell'].pending).toBe(0);

      expect(stats.by_tool['edit']).toBeDefined();
      expect(stats.by_tool['edit'].total).toBe(1);
      expect(stats.by_tool['edit'].approved).toBe(1);
      expect(stats.by_tool['edit'].rejected).toBe(0);
    });

    it('should calculate statistics by danger level', async () => {
      const stats = await logger.getApprovalStats();

      expect(stats.by_danger_level['dangerous']).toBeDefined();
      expect(stats.by_danger_level['dangerous'].total).toBe(2);
      expect(stats.by_danger_level['dangerous'].approved).toBe(1);

      expect(stats.by_danger_level['warning']).toBeDefined();
      expect(stats.by_danger_level['warning'].total).toBe(1);
      expect(stats.by_danger_level['warning'].approved).toBe(1);
    });

    it('should exclude pending requests from rejected counts', async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-pending',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'pending',
        decision_reason: 'pending_user_approval',
        session_id: 'session-1',
      });

      const stats = await logger.getApprovalStats();
      expect(stats.total_requests).toBe(3);
      expect(stats.pending_requests).toBe(1);
      expect(stats.rejected).toBe(1);
      expect(stats.by_tool['run_shell'].pending).toBe(1);
    });

    it('should collapse pending and final rows by request_id', async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-merge',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'pending',
        decision_reason: 'pending_user_approval',
        session_id: 'session-1',
      });
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-merge',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'approved',
        approved: true,
        decision_reason: 'user_approved',
        session_id: 'session-1',
      });

      const stats = await logger.getApprovalStats();
      expect(stats.total_requests).toBe(4);
      expect(stats.pending_requests).toBe(0);
      expect(stats.approved).toBe(3);
      expect(stats.by_tool['run_shell'].total).toBe(3);
    });
  });

  describe('tool-specific statistics', () => {
    it('should return tool stats with approval rate', async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-1',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'approved',
        approved: true,
        session_id: 'session-1',
      });

      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-2',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'edited',
        approved: true,
        session_id: 'session-1',
      });

      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-3',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'rejected',
        approved: false,
        session_id: 'session-1',
      });

      const stats = await logger.getToolStats('run_shell');

      expect(stats).toBeDefined();
      expect(stats!.total).toBe(3);
      expect(stats!.approved).toBe(2);
      expect(stats!.rejected).toBe(1);
      expect(stats!.pending).toBe(0);
      expect(stats!.approvalRate).toBeCloseTo(0.667, 2);
    });

    it('should return null for non-existent tool', async () => {
      const stats = await logger.getToolStats('nonexistent_tool');
      expect(stats).toBeNull();
    });
  });

  describe('querying rejected and dangerous requests', () => {
    beforeEach(async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-1',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'rejected',
        approved: false,
        session_id: 'session-1',
      });

      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-2',
        tool_name: 'edit',
        danger_level: 'warning',
        status: 'approved',
        approved: true,
        session_id: 'session-1',
      });

      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-3',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'approved',
        approved: true,
        session_id: 'session-1',
      });
    });

    it('should retrieve rejected requests', async () => {
      const rejected = await logger.getRejectedRequests();

      expect(rejected).toHaveLength(1);
      expect(rejected[0].request_id).toBe('req-1');
      expect(rejected[0].status).toBe('rejected');
    });

    it('should ignore pending requests when retrieving rejections', async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-pending',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'pending',
        decision_reason: 'pending_user_approval',
        session_id: 'session-1',
      });

      const rejected = await logger.getRejectedRequests();
      expect(rejected).toHaveLength(1);
    });

    it('should limit rejected requests', async () => {
      for (let i = 0; i < 10; i++) {
        await logger.logApprovalRequest({
          timestamp: Date.now(),
          request_id: `req-extra-${i}`,
          tool_name: 'run_shell',
          danger_level: 'dangerous',
          status: 'rejected',
          approved: false,
          session_id: 'session-1',
        });
      }

      const rejected = await logger.getRejectedRequests(5);
      expect(rejected).toHaveLength(5);
    });

    it('should retrieve dangerous approvals using final metadata', async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-final',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'pending',
        decision_reason: 'pending_user_approval',
        session_id: 'session-1',
      });
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-final',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'approved',
        approved: true,
        decision_reason: 'user_approved',
        session_id: 'session-1',
      });

      const dangerous = await logger.getDangerousApprovals();

      expect(dangerous).toHaveLength(2);
      expect(dangerous.some(log => log.request_id === 'req-3')).toBe(true);
      expect(dangerous.some(log => log.request_id === 'req-final')).toBe(true);
    });
  });

  describe('persistence', () => {
    it('should persist logs to disk', async () => {
      await logger.logApprovalRequest({
        timestamp: Date.now(),
        request_id: 'req-1',
        tool_name: 'run_shell',
        danger_level: 'dangerous',
        status: 'pending',
        decision_reason: 'pending_user_approval',
        session_id: 'session-1',
      });

      const logger2 = new ApprovalLogger(tempDir);
      await logger2.init();
      const logs = await logger2.getAllLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0].request_id).toBe('req-1');
      expect(logs[0].status).toBe('pending');
    });
  });

  describe('empty log file', () => {
    it('should handle empty log file gracefully', async () => {
      const stats = await logger.getApprovalStats();

      expect(stats.total_requests).toBe(0);
      expect(stats.pending_requests).toBe(0);
      expect(stats.approved).toBe(0);
      expect(stats.rejected).toBe(0);
      expect(Object.keys(stats.by_tool)).toHaveLength(0);
    });

    it('should return empty array for all logs', async () => {
      const logs = await logger.getAllLogs();
      expect(logs).toHaveLength(0);
    });
  });
});
