/**
 * Slash command stub for agent package.
 *
 * Slash commands are handled in the terminal (TUI) layer, not in the agent core.
 * This file provides a minimal agent-layer interface for compatibility.
 *
 * @see packages/tui/src/repl/slash.ts for the real implementation.
 */

import type { Session } from '../foundation/types.js';
import type { SkillRegistry } from '../skills/registry.js';

/**
 * Slash command handler stub.
 * Always returns false since the agent layer does not process slash commands.
 * The terminal TUI layer handles all slash command parsing and execution.
 */
export function handle_slash_command(
  _input: string,
  _session: Session,
  _skill_reg: SkillRegistry,
): boolean {
  return false;
}

/**
 * Returns help text for slash commands (not available in agent REPL).
 */
export function get_help_text(): string {
  return 'Slash commands are not available in the standalone agent REPL. Use the terminal TUI for access to slash commands.';
}

