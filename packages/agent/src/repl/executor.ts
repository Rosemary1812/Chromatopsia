// T-23: repl/executor.ts — REPL compatibility exports.
// Skill execution is guidance-driven; this module no longer parses skill Markdown into tool calls.
export { execute_tool_calls_parallel } from '../foundation/tools/executor.js';
