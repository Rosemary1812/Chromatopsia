// T-08: Bash Tool - run_shell command execution with sandbox
import { spawn } from 'child_process';
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';

// ============================================================
// Dangerous Pattern Detection
// ============================================================

const DENIED_PATTERNS: RegExp[] = [
  /^\s*rm\s+-rf/i,
  /^\s*git\s+push\s+--force/i,
  /^\s*git\s+push\s+-f/i,
  /^\s*dd\s+/i,
  /^\s*mkfs/i,
  /^\s*fdisk/i,
  /^\s*drop\s+(table|database)/i,
  /^\s*shutdown/i,
  /^\s*reboot/i,
  /^\s*sudo\s+su/i,
  /^\s*chmod\s+-R\s+777/i,
  /^\s*curl\b[^\n]*\|\s*sh\b/i,
  /^\s*wget\b[^\n]*\|\s*sh\b/i,
];

function is_dangerous_command(command: string): boolean {
  return DENIED_PATTERNS.some((pattern) => pattern.test(command.trim()));
}

// ============================================================
// Sandbox
// ============================================================

/**
 * Sanitize a bash command for sandboxed execution.
 * - Rewrites `cd ..` to prevent directory traversal
 * - Blocks access to paths outside working directory
 * - Replaces ~ with cwd
 */
export function sandbox_bash_command(cmd: string, cwd: string): string {
  const lines = cmd.split('\n');
  const sanitized = lines
    .map((line) => {
      let sanitized_line = line.trim();

      // Block .. directory traversal
      sanitized_line = sanitized_line.replace(/\.\.\//g, '');
      sanitized_line = sanitized_line.replace(/^\s*cd\s+\.\./, '');

      // Replace ~ with cwd
      sanitized_line = sanitized_line.replace(/~/g, cwd);

      // Block absolute paths outside cwd
      const absPathMatch = sanitized_line.match(/\/(?!\.)([^\s]+)/g);
      if (absPathMatch) {
        for (const match of absPathMatch) {
          const absPath = match.startsWith('/') ? match : `/${match}`;
          if (!absPath.startsWith(cwd) && !absPath.startsWith('/.')) {
            sanitized_line = sanitized_line.replace(match, '');
          }
        }
      }

      return sanitized_line;
    })
    .join(' && ');

  return sanitized.trim();
}

// ============================================================
// run_shell Handler
// ============================================================

interface RunShellArgs {
  command: string;
  timeout?: number;
}

async function run_shell_handler(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const { command, timeout = 60000 } = args as unknown as RunShellArgs;

  // Validate command is non-empty
  if (!command || typeof command !== 'string' || command.trim() === '') {
    return {
      tool_call_id: '',
      output: 'Error: command cannot be empty',
      success: false,
    };
  }

  // Check for dangerous patterns - deny immediately
  if (is_dangerous_command(command)) {
    return {
      tool_call_id: '',
      output: `Error: Command denied - dangerous pattern detected: ${command}`,
      success: false,
    };
  }

  // Sandbox the command
  const sanitized = sandbox_bash_command(command, context.working_directory);

  // Execute the command
  return new Promise<ToolResult>((resolve) => {
    const start = Date.now();
    const isWindows = process.platform === 'win32';

    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/c', sanitized] : ['-c', sanitized];

    const proc = spawn(shell, shellArgs, {
      cwd: context.working_directory,
      env: { ...process.env, PWD: context.working_directory },
      timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      const elapsed = Date.now() - start;
      resolve({
        tool_call_id: '',
        output: `Error: ${err.message} (${elapsed}ms)`,
        success: false,
      });
    });

    proc.on('close', (code) => {
      const elapsed = Date.now() - start;
      const output = stdout + (stderr ? `\n${stderr}` : '');
      resolve({
        tool_call_id: '',
        output: output || `(exited with code ${code}, ${elapsed}ms)`,
        success: code === 0,
      });
    });

    // Handle timeout
    setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        tool_call_id: '',
        output: `Error: Command timed out after ${timeout}ms`,
        success: false,
      });
    }, timeout);
  });
}

// ============================================================
// Tool Definition
// ============================================================

export const run_shell_definition: ToolDefinition = {
  name: 'run_shell',
  description:
    'Execute a bash command in the project directory. Use for running scripts, git commands, npm, etc.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Max execution time in ms (default: 60000)',
      },
    },
    required: ['command'],
  },
  danger_level: 'dangerous',
  handler: run_shell_handler,
};
