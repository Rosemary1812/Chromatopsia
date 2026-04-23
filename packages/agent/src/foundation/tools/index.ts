/**
 * Tool System — Centralized Registration
 *
 * All 7 built-in tools must be registered with the global registry
 * before the REPL can use them. Call `register_all_tools()` during
 * agent initialization.
 */

import { registry } from './registry.js';
import { read_definition } from './read.js';
import { edit_definition } from './edit.js';
import { glob_definition } from './glob.js';
import { grep_definition } from './grep.js';
import { run_shell_definition } from './bash.js';
import { websearch_definition } from './websearch.js';
import { webfetch_definition } from './webfetch.js';
import { create_skill_definition } from './skill.js';
import type { SkillStore } from '../../skills/store.js';

/**
 * Register all 7 built-in tools with the global registry.
 * Call this once during agent startup before running the REPL.
 */
export function register_all_tools(skillStore?: SkillStore): void {
  registry.register(read_definition);
  registry.register(edit_definition);
  registry.register(glob_definition);
  registry.register(grep_definition);
  registry.register(run_shell_definition);
  registry.register(websearch_definition);
  registry.register(webfetch_definition);
  if (skillStore) {
    registry.register(create_skill_definition(skillStore));
  }
}

export function register_skill_tool(skillStore: SkillStore): void {
  registry.register(create_skill_definition(skillStore));
}

