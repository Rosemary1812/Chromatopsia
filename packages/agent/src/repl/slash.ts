/**
 * Slash command stub for agent package.
 *
 * Slash commands are handled in the terminal (TUI) layer, not in the agent.
 * This stub exists only to satisfy imports from test files.
 *
 * @see packages/terminal/src/repl/slash.ts for the real implementation.
 */

import type { Session } from '../foundation/types.js';
import type { SkillRegistry } from '../skills/registry.js';

/**
 * Re-exported from terminal package. See terminal/slash.ts for real implementation.
 * In the agent's standalone REPL (readline-based), slash commands are not supported.
 */
export function handle_slash_command(
  _input: string,
  _session: Session,
  _skill_reg: SkillRegistry,
): boolean {
  // Slash commands are terminal-layer concern; agent loop does not handle them.
  return false;
}

export function get_help_text(): string {
  return 'Slash commands are not available in the agent REPL. Use /help in the terminal TUI.';
}

export const SLASH_COMMANDS: Record<string, { description: string; handler: (...args: unknown[]) => unknown }> = {};
