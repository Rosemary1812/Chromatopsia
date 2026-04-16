import { describe, expect, it } from 'vitest';
import { ApprovalController } from '../../tui/src/approval-controller.js';

describe('ApprovalController', () => {
  it('resolves a pending approval response', async () => {
    const controller = new ApprovalController();
    const pending = controller.waitForResponse({
      id: 'req-1',
      tool_name: 'run_shell',
      args: { command: 'echo hi' },
      context: 'tool execution',
      timestamp: Date.now(),
    });

    controller.respond('approve');

    await expect(pending).resolves.toEqual({
      request_id: 'req-1',
      decision: 'approve',
    });
  });
});
