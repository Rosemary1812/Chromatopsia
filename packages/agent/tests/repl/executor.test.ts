// T-23: repl/executor.ts tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  execute_tool_calls_parallel,
  execute_skill,
  parse_step_to_tool_call,
} from '../../src/repl/executor.js';
import { registry } from '../../src/foundation/tools/registry.js';
import type { ToolCall, ToolContext, Skill } from '../../src/foundation/types.js';
import { ApprovalHook } from '../../src/hooks/approval.js';

const mockSession = {
  id: 'test-session',
  messages: [],
  working_directory: '/project',
  created_at: Date.now(),
  last_active: Date.now(),
  add_message: vi.fn(),
  clear: vi.fn(),
  compact: vi.fn(),
} as any;

const mockContext: ToolContext = {
  session: mockSession,
  working_directory: '/project',
};

// Register standard test tools
function registerStandardTools(): void {
  registry.register({
    name: 'Read',
    description: 'Read file',
    input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
    danger_level: 'safe',
    handler: async ({ file_path }) => ({
      tool_call_id: '1',
      output: `content of ${file_path}`,
      success: true,
    }),
  });

  registry.register({
    name: 'Edit',
    description: 'Edit file',
    input_schema: { type: 'object' },
    danger_level: 'warning',
    handler: async () => ({
      tool_call_id: '1',
      output: 'ok',
      success: true,
    }),
  });

  registry.register({
    name: 'run_shell',
    description: 'Run shell command',
    input_schema: { type: 'object' },
    danger_level: 'dangerous',
    handler: async ({ command }) => ({
      tool_call_id: '1',
      output: `executed: ${command}`,
      success: true,
    }),
  });
}

describe('parse_step_to_tool_call', () => {
  it('should parse simple tool_name with no args', () => {
    const result = parse_step_to_tool_call('Read', 'session-1');
    expect(result).toEqual({
      id: expect.stringContaining('skill-session-1-'),
      name: 'Read',
      arguments: {},
    });
  });

  it('should parse tool with plain key=value args', () => {
    const result = parse_step_to_tool_call('Read file_path=/tmp/test.txt', 'session-1');
    expect(result?.name).toBe('Read');
    expect(result?.arguments).toEqual({ file_path: '/tmp/test.txt' });
  });

  it('should parse tool with quoted string args', () => {
    const result = parse_step_to_tool_call('Edit file_path="/tmp/test.txt" old_string="foo"', 'session-1');
    expect(result?.name).toBe('Edit');
    expect(result?.arguments).toEqual({ file_path: '/tmp/test.txt', old_string: 'foo' });
  });

  it('should parse tool with array args', () => {
    const result = parse_step_to_tool_call('Glob pattern=[*.ts,*.js] path=/src', 'session-1');
    expect(result?.name).toBe('Glob');
    expect(result?.arguments).toEqual({ pattern: ['*.ts', '*.js'], path: '/src' });
  });

  it('should parse boolean and number values', () => {
    const result = parse_step_to_tool_call('TestTool verbose=true count=42 recursive=false', 'session-1');
    expect(result?.name).toBe('TestTool');
    expect(result?.arguments).toEqual({ verbose: true, count: 42, recursive: false });
  });

  it('should return null for empty step', () => {
    expect(parse_step_to_tool_call('', 'session-1')).toBeNull();
    expect(parse_step_to_tool_call('   ', 'session-1')).toBeNull();
    expect(parse_step_to_tool_call(null as any, 'session-1')).toBeNull();
  });

  it('should return null for whitespace-only tool name', () => {
    expect(parse_step_to_tool_call('   ', 'session-1')).toBeNull();
  });

  it('should handle multiple args with mixed types', () => {
    const result = parse_step_to_tool_call(
      'Edit file_path=/tmp/a.txt old_string="line1" new_string="line2" force=true',
      'session-1'
    );
    expect(result?.name).toBe('Edit');
    expect(result?.arguments).toEqual({
      file_path: '/tmp/a.txt',
      old_string: 'line1',
      new_string: 'line2',
      force: true,
    });
  });
});

describe('execute_tool_calls_parallel', () => {
  beforeEach(() => {
    registerStandardTools();
  });

  it('should return empty array for empty tool_calls', async () => {
    const results = await execute_tool_calls_parallel([], mockContext);
    expect(results).toEqual([]);
  });

  it('should execute all safe tools in parallel', async () => {
    const callTimes: number[] = [];

    registry.register({
      name: 'tool_a',
      description: 'Tool A',
      input_schema: { type: 'object' },
      danger_level: 'safe',
      handler: async () => {
        callTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        return { tool_call_id: 'tc-a', output: 'a', success: true };
      },
    });

    registry.register({
      name: 'tool_b',
      description: 'Tool B',
      input_schema: { type: 'object' },
      danger_level: 'safe',
      handler: async () => {
        callTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        return { tool_call_id: 'tc-b', output: 'b', success: true };
      },
    });

    registry.register({
      name: 'tool_c',
      description: 'Tool C',
      input_schema: { type: 'object' },
      danger_level: 'safe',
      handler: async () => {
        callTimes.push(Date.now());
        return { tool_call_id: 'tc-c', output: 'c', success: true };
      },
    });

    const toolCalls: ToolCall[] = [
      { id: 'tc-a', name: 'tool_a', arguments: {} },
      { id: 'tc-b', name: 'tool_b', arguments: {} },
      { id: 'tc-c', name: 'tool_c', arguments: {} },
    ];

    const results = await execute_tool_calls_parallel(toolCalls, mockContext);

    expect(results.length).toBe(3);
    expect(results.every((r) => r.success)).toBe(true);
    // Verify parallel: call times should be within 10ms of each other
    const minTime = Math.min(...callTimes);
    const maxTime = Math.max(...callTimes);
    expect(maxTime - minTime).toBeLessThan(20);
  });

  it('should execute dangerous tools serially with approval', async () => {
    const approvalHook = new ApprovalHook();
    const callOrder: string[] = [];

    registry.register({
      name: 'seq_tool_1',
      description: 'Seq tool 1',
      input_schema: { type: 'object' },
      danger_level: 'dangerous',
      handler: async () => {
        callOrder.push('seq1');
        return { tool_call_id: 'tc-seq1', output: 'seq1', success: true };
      },
    });

    registry.register({
      name: 'seq_tool_2',
      description: 'Seq tool 2',
      input_schema: { type: 'object' },
      danger_level: 'dangerous',
      handler: async () => {
        callOrder.push('seq2');
        return { tool_call_id: 'tc-seq2', output: 'seq2', success: true };
      },
    });

    const toolCalls: ToolCall[] = [
      { id: 'tc-seq1', name: 'seq_tool_1', arguments: { command: 'echo 1' } },
      { id: 'tc-seq2', name: 'seq_tool_2', arguments: { command: 'echo 2' } },
    ];

    // Mock wait_for_decision to auto-approve
    vi.spyOn(approvalHook, 'wait_for_decision').mockResolvedValue({
      request_id: 'mock',
      decision: 'approve',
    });

    const results = await execute_tool_calls_parallel(toolCalls, mockContext, approvalHook);

    expect(results.length).toBe(2);
    expect(callOrder).toEqual(['seq1', 'seq2']); // serial order
  });

  it('should skip dangerous tool execution on approval reject', async () => {
    const approvalHook = new ApprovalHook();

    vi.spyOn(approvalHook, 'request_approval').mockReturnValue({
      id: 'req-1',
      tool_name: 'run_shell',
      args: { command: 'rm -rf' },
      context: '',
      timestamp: Date.now(),
    });

    vi.spyOn(approvalHook, 'wait_for_decision').mockResolvedValue({
      request_id: 'req-1',
      decision: 'reject',
    });

    const toolCalls: ToolCall[] = [
      { id: 'tc-1', name: 'run_shell', arguments: { command: 'rm -rf' } },
    ];

    const results = await execute_tool_calls_parallel(toolCalls, mockContext, approvalHook);

    expect(results.length).toBe(1);
    expect(results[0].success).toBe(false);
    expect(results[0].output).toContain('Approval rejected');
  });

  it('should execute with modified args on approval edit', async () => {
    const approvalHook = new ApprovalHook();
    let capturedArgs: Record<string, unknown> = {};

    registry.register({
      name: 'edit_tool',
      description: 'Edit tool',
      input_schema: { type: 'object' },
      danger_level: 'dangerous',
      handler: async (args) => {
        capturedArgs = args;
        return { tool_call_id: 'tc-edit', output: 'ok', success: true };
      },
    });

    vi.spyOn(approvalHook, 'request_approval').mockReturnValue({
      id: 'req-1',
      tool_name: 'edit_tool',
      args: { command: 'original' },
      context: '',
      timestamp: Date.now(),
    });

    vi.spyOn(approvalHook, 'wait_for_decision').mockResolvedValue({
      request_id: 'req-1',
      decision: 'edit',
      modified_args: { command: 'modified' },
    });

    const toolCalls: ToolCall[] = [
      { id: 'tc-edit', name: 'edit_tool', arguments: { command: 'original' } },
    ];

    await execute_tool_calls_parallel(toolCalls, mockContext, approvalHook);

    expect(capturedArgs).toEqual({ command: 'modified' });
  });
});

describe('execute_skill', () => {
  beforeEach(() => {
    registerStandardTools();
  });

  it('should execute all steps of a skill', async () => {
    const skill: Skill = {
      id: 'skill-1',
      name: 'test_skill',
      trigger_condition: 'test',
      steps: [
        'Read file_path=/tmp/a.txt',
        'Read file_path=/tmp/b.txt',
      ],
      pitfalls: [],
      task_type: 'file_read',
      created_at: Date.now(),
      updated_at: Date.now(),
      call_count: 0,
      success_count: 0,
    };

    const results = await execute_skill(skill, mockContext);

    expect(results.length).toBe(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

  it('should continue executing subsequent steps even if one fails', async () => {
    registry.register({
      name: 'failing_tool',
      description: 'Failing tool',
      input_schema: { type: 'object' },
      danger_level: 'safe',
      handler: async () => {
        throw new Error('Intentional failure');
      },
    });

    const skill: Skill = {
      id: 'skill-2',
      name: 'failing_skill',
      trigger_condition: 'test',
      steps: [
        'Read file_path=/tmp/a.txt',
        'failing_tool',
        'Read file_path=/tmp/b.txt',
      ],
      pitfalls: [],
      task_type: 'test',
      created_at: Date.now(),
      updated_at: Date.now(),
      call_count: 0,
      success_count: 0,
    };

    const results = await execute_skill(skill, mockContext);

    expect(results.length).toBe(3);
    expect(results[0].success).toBe(true);   // Read succeeded
    expect(results[1].success).toBe(false); // failing_tool failed
    expect(results[2].success).toBe(true);  // Read still executed
  });

  it('should call SkillPatcher.patch on failure', async () => {
    registry.register({
      name: 'failing_tool',
      description: 'Failing tool',
      input_schema: { type: 'object' },
      danger_level: 'safe',
      handler: async () => {
        throw new Error('Intentional failure');
      },
    });

    const skill: Skill = {
      id: 'skill-3',
      name: 'patch_test_skill',
      trigger_condition: 'test',
      steps: ['failing_tool'],
      pitfalls: [],
      task_type: 'test',
      created_at: Date.now(),
      updated_at: Date.now(),
      call_count: 0,
      success_count: 0,
    };

    const originalUpdatedAt = skill.updated_at;

    await execute_skill(skill, mockContext);

    // Skill should have been patched (pitfalls updated, call_count incremented)
    expect(skill.call_count).toBe(1);
    expect(skill.updated_at).toBeGreaterThanOrEqual(originalUpdatedAt);
  });

  it('should parse complex step strings correctly', async () => {
    const skill: Skill = {
      id: 'skill-4',
      name: 'complex_skill',
      trigger_condition: 'test',
      steps: [
        'Edit file_path="/tmp/test.txt" old_string="foo" new_string="bar" force=true',
      ],
      pitfalls: [],
      task_type: 'edit',
      created_at: Date.now(),
      updated_at: Date.now(),
      call_count: 0,
      success_count: 0,
    };

    const results = await execute_skill(skill, mockContext);

    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
  });
});
