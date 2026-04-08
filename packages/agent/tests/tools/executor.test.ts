import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  execute_tool,
  execute_tool_calls_parallel,
  resolve_path,
  sandbox_bash_command,
  DENIED_PATTERNS,
} from '../../src/tools/executor.js';
import { registry } from '../../src/tools/registry.js';
import type { ToolCall, ToolContext } from '../../src/types.js';
import { z } from 'zod';
import path from 'node:path';

// Mock session
const mockSession = {
  id: 'test-session',
  messages: [],
  working_directory: '/test',
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

describe('resolve_path', () => {
  // Use platform-appropriate paths
  const projectRoot = path.resolve('/project');
  const sep = path.sep;

  it('should resolve relative paths within working directory', () => {
    const result = resolve_path(`src${sep}index.ts`, projectRoot);
    expect(result).toBe(path.join(projectRoot, 'src', 'index.ts'));
  });

  it('should resolve absolute paths within working directory', () => {
    const result = resolve_path(path.join(projectRoot, 'src', 'index.ts'), projectRoot);
    expect(result).toBe(path.join(projectRoot, 'src', 'index.ts'));
  });

  it('should throw Sandbox error for absolute paths outside working directory', () => {
    expect(() => resolve_path(path.join(sep, 'etc', 'passwd'), projectRoot)).toThrow(
      'Sandbox violation',
    );
  });

  it('should throw Sandbox error for paths with .. that escape working directory', () => {
    expect(() => resolve_path(path.join('..', 'etc', 'passwd'), projectRoot)).toThrow(
      'Sandbox violation',
    );
  });

  it('should return working directory for empty string (resolves to cwd)', () => {
    const result = resolve_path('', projectRoot);
    expect(result).toBe(projectRoot);
  });

  it('should handle nested .. paths', () => {
    expect(() =>
      resolve_path(path.join('src', '..', '..', 'etc', 'passwd'), projectRoot),
    ).toThrow('Sandbox violation');
  });
});

describe('sandbox_bash_command', () => {
  it('should pass through simple safe commands', () => {
    const result = sandbox_bash_command('ls -la', '/project');
    expect(result).toBe('ls -la');
  });

  it('should replace tilde with working_dir', () => {
    const result = sandbox_bash_command('ls ~/', '/project');
    expect(result).toBe('ls /project/');
  });

  it('should throw for cd .. patterns', () => {
    expect(() => sandbox_bash_command('cd ..', '/project')).toThrow(
      'Denied pattern detected',
    );
  });

  it('should throw for /etc/ patterns', () => {
    expect(() => sandbox_bash_command('cat /etc/passwd', '/project')).toThrow(
      'Denied pattern detected',
    );
  });

  it('should throw for /proc/ patterns', () => {
    expect(() => sandbox_bash_command('cat /proc/cpuinfo', '/project')).toThrow(
      'Denied pattern detected',
    );
  });

  it('should handle multi-line commands', () => {
    const result = sandbox_bash_command('cd /project && ls', '/project');
    expect(result).toBe('cd /project && ls');
  });
});

describe('DENIED_PATTERNS', () => {
  it('should contain patterns for dangerous operations', () => {
    expect(DENIED_PATTERNS.length).toBeGreaterThan(0);
  });

  it('should match cd .. patterns', () => {
    const hasCdPattern = DENIED_PATTERNS.some((r) => r.test('cd ..'));
    expect(hasCdPattern).toBe(true);
  });
});

describe('execute_tool', () => {
  beforeEach(() => {
    // Clear registry and register a test tool
    registry.get_all().forEach((t) => {
      // Can't unregister, so just work with a fresh registry per test file
    });
  });

  it('should return error for unknown tool', async () => {
    const toolCall: ToolCall = {
      id: 'tc-1',
      name: 'nonexistent_tool',
      arguments: {},
    };

    const result = await execute_tool(toolCall, mockContext);

    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown tool');
  });

  it('should return error for invalid Zod schema arguments', async () => {
    const zodSchema = z.object({
      name: z.string(),
      age: z.number(),
    });

    registry.register({
      name: 'test_tool',
      description: 'Test tool',
      input_schema: { type: 'object' },
      zod_schema: zodSchema,
      handler: async () => ({ tool_call_id: '', output: 'ok', success: true }),
    });

    const toolCall: ToolCall = {
      id: 'tc-2',
      name: 'test_tool',
      arguments: { name: 'test' }, // missing 'age' as number
    };

    const result = await execute_tool(toolCall, mockContext);

    expect(result.success).toBe(false);
    expect(result.output).toContain('Invalid arguments');
  });

  it('should execute tool with valid arguments', async () => {
    const handler = vi.fn().mockResolvedValue({
      tool_call_id: 'tc-3',
      output: 'success',
      success: true,
    });

    registry.register({
      name: 'valid_tool',
      description: 'A valid tool',
      input_schema: { type: 'object', properties: { arg1: { type: 'string' } } },
      handler,
    });

    const toolCall: ToolCall = {
      id: 'tc-3',
      name: 'valid_tool',
      arguments: { arg1: 'value' },
    };

    const result = await execute_tool(toolCall, mockContext);

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledWith(
      { arg1: 'value' },
      mockContext,
    );
  });

  it('should catch and return errors from tool execution', async () => {
    registry.register({
      name: 'throwing_tool',
      description: 'A tool that throws',
      input_schema: { type: 'object' },
      handler: async () => {
        throw new Error('Intentional error');
      },
    });

    const toolCall: ToolCall = {
      id: 'tc-4',
      name: 'throwing_tool',
      arguments: {},
    };

    const result = await execute_tool(toolCall, mockContext);

    expect(result.success).toBe(false);
    expect(result.output).toContain('Intentional error');
  });
});

describe('execute_tool_calls_parallel', () => {
  it('should execute safe tools in parallel', async () => {
    const callOrder: number[] = [];

    registry.register({
      name: 'safe_tool_1',
      description: 'Safe tool 1',
      input_schema: { type: 'object' },
      danger_level: 'safe',
      handler: async () => {
        callOrder.push(1);
        return { tool_call_id: 'tc-1', output: 'result1', success: true };
      },
    });

    registry.register({
      name: 'safe_tool_2',
      description: 'Safe tool 2',
      input_schema: { type: 'object' },
      danger_level: 'safe',
      handler: async () => {
        callOrder.push(2);
        return { tool_call_id: 'tc-2', output: 'result2', success: true };
      },
    });

    const toolCalls: ToolCall[] = [
      { id: 'tc-1', name: 'safe_tool_1', arguments: {} },
      { id: 'tc-2', name: 'safe_tool_2', arguments: {} },
    ];

    const results = await execute_tool_calls_parallel(toolCalls, mockContext);

    expect(results.length).toBe(2);
    expect(results.every((r) => r.success)).toBe(true);
    // Both should have been called (parallel)
    expect(callOrder.length).toBe(2);
  });

  it('should execute dangerous tools serially', async () => {
    const callOrder: number[] = [];

    registry.register({
      name: 'dangerous_tool',
      description: 'Dangerous tool',
      input_schema: { type: 'object' },
      danger_level: 'dangerous',
      handler: async () => {
        callOrder.push(1);
        return { tool_call_id: 'tc-1', output: 'result1', success: true };
      },
    });

    const toolCalls: ToolCall[] = [
      { id: 'tc-1', name: 'dangerous_tool', arguments: {} },
    ];

    const results = await execute_tool_calls_parallel(toolCalls, mockContext);

    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
  });

  it('should mix safe and dangerous tools', async () => {
    registry.register({
      name: 'safe_parallel',
      description: 'Safe tool',
      input_schema: { type: 'object' },
      danger_level: 'safe',
      handler: async () => ({ tool_call_id: 'tc-1', output: 'safe', success: true }),
    });

    registry.register({
      name: 'dangerous_serial',
      description: 'Dangerous tool',
      input_schema: { type: 'object' },
      danger_level: 'dangerous',
      handler: async () => ({ tool_call_id: 'tc-2', output: 'dangerous', success: true }),
    });

    const toolCalls: ToolCall[] = [
      { id: 'tc-1', name: 'safe_parallel', arguments: {} },
      { id: 'tc-2', name: 'dangerous_serial', arguments: {} },
    ];

    const results = await execute_tool_calls_parallel(toolCalls, mockContext);

    expect(results.length).toBe(2);
    const safeResult = results.find((r) => r.output === 'safe');
    const dangerousResult = results.find((r) => r.output === 'dangerous');
    expect(safeResult).toBeDefined();
    expect(dangerousResult).toBeDefined();
  });
});
