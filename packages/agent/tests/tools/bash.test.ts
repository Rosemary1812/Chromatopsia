// T-08: Bash Tool tests
import { describe, it, expect, beforeEach } from 'vitest';
import { sandbox_bash_command, run_shell_definition } from '../../src/foundation/tools/bash.js';
import type { ToolContext } from '../../src/foundation/types.js';

describe('bash tool', () => {
  describe('sandbox_bash_command', () => {
    const cwd = '/project';

    it('should allow simple commands', () => {
      expect(sandbox_bash_command('echo hello', cwd)).toBe('echo hello');
    });

    it('should allow git commands', () => {
      expect(sandbox_bash_command('git status', cwd)).toBe('git status');
    });

    it('should block directory traversal with ..', () => {
      const result = sandbox_bash_command('cd ../ && ls', cwd);
      expect(result).not.toContain('..');
    });

    it('should replace tilde with cwd', () => {
      const result = sandbox_bash_command('ls ~', cwd);
      expect(result).toContain(cwd);
      expect(result).not.toContain('~');
    });

    it('should handle multiline commands', () => {
      const result = sandbox_bash_command('echo a && echo b', cwd);
      expect(result).toBe('echo a && echo b');
    });
  });

  describe('run_shell_definition', () => {
    it('should have correct tool name', () => {
      expect(run_shell_definition.name).toBe('run_shell');
    });

    it('should be marked as dangerous', () => {
      expect(run_shell_definition.danger_level).toBe('dangerous');
    });

    it('should have required command parameter', () => {
      const schema = run_shell_definition.input_schema as {
        properties: Record<string, { type: string }>;
        required: string[];
      };
      expect(schema.properties.command).toBeDefined();
      expect(schema.required).toContain('command');
    });
  });

  describe('run_shell handler', () => {
    const mockContext: ToolContext = {
      session: {} as any,
      working_directory: process.cwd(),
    };

    it('should reject empty command', async () => {
      const result = await run_shell_definition.handler({}, mockContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain('empty');
    });

    it('should reject rm -rf command', async () => {
      const result = await run_shell_definition.handler(
        { command: 'rm -rf /' },
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('denied');
    });

    it('should reject git push --force', async () => {
      const result = await run_shell_definition.handler(
        { command: 'git push --force origin main' },
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('denied');
    });

    it('should execute simple echo command', async () => {
      const result = await run_shell_definition.handler(
        { command: 'echo hello' },
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain('hello');
    }, 10000);

    it('should handle command with timeout', async () => {
      const result = await run_shell_definition.handler(
        { command: 'sleep 0.1 && echo done', timeout: 5000 },
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain('done');
    }, 10000);

    it('should timeout long running commands', async () => {
      const result = await run_shell_definition.handler(
        { command: 'sleep 5', timeout: 100 },
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('timed out');
    }, 10000);
  });
});
