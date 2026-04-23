import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, TaskBufferEntry } from '../../src/foundation/types.js';
import {
  parse_synthesis_result,
  summarize_task_buffer,
  synthesize_skill,
} from '../../src/learning/synthesis.js';

const makeEntry = (task_type: string, tool_names: string[]): TaskBufferEntry => ({
  tool_calls: tool_names.map((name, i) => ({ id: `tc-${i}`, name, arguments: {} })),
  tool_results: tool_names.map((_, i) => ({ tool_call_id: `tc-${i}`, output: 'ok', success: true })),
  task_type,
  session_id: 'test-session',
  timestamp: Date.now(),
});

const skillMarkdown = `---
id: git-status-review
name: Git Status Review
description: Use when the user asks to inspect git status and summarize repository risk.
user-invocable: true
context: inline
triggers:
  - inspect git status
task_type: git
scope: learning_draft
enabled: false
priority: 10
version: 1
updated_at: 2026-04-23T00:00:00.000Z
---

# Git Status Review

## When To Use
Use this when git status and repository risk need to be summarized.

## Procedure
Inspect status and diffs, then explain risks before suggesting changes.

## Pitfalls
Do not discard user work.

## Verification
Confirm the answer references the observed status.`;

describe('learning/synthesis', () => {
  it('summarize_task_buffer returns (empty) for empty buffer', () => {
    expect(summarize_task_buffer([])).toBe('(empty)');
  });

  it('summarize_task_buffer formats tool names', () => {
    const summary = summarize_task_buffer([makeEntry('git-commit', ['run_shell', 'Read'])]);
    expect(summary).toContain('git-commit');
    expect(summary).toContain('run_shell');
    expect(summary).toContain('Read');
  });

  it('parse_synthesis_result parses raw SKILL.md guidance', () => {
    const result = parse_synthesis_result(skillMarkdown);
    expect(result.should_learn).toBe(true);
    expect(result.document?.manifest.id).toBe('git-status-review');
    expect(result.document?.body).toContain('## Procedure');
    expect(result.skill.name).toBe('Git Status Review');
  });

  it('parse_synthesis_result extracts SKILL.md from markdown code block', () => {
    const result = parse_synthesis_result(`Some text is not allowed outside exact fence?\n\`\`\`markdown\n${skillMarkdown}\n\`\`\``);
    expect(result.should_learn).toBe(false);

    const fenced = parse_synthesis_result(`\`\`\`md\n${skillMarkdown}\n\`\`\``);
    expect(fenced.document?.manifest.name).toBe('Git Status Review');
  });

  it('parse_synthesis_result parses no-learn JSON', () => {
    const result = parse_synthesis_result('{"should_learn":false,"confidence":0.4,"reasoning":"not reusable"}');
    expect(result.skill).toEqual({});
    expect(result.should_learn).toBe(false);
    expect(result.confidence).toBe(0.4);
    expect(result.reasoning).toBe('not reusable');
  });

  it('parse_synthesis_result returns empty skill on invalid output', () => {
    const result = parse_synthesis_result('not json or markdown at all');
    expect(result.skill).toEqual({});
    expect(result.should_learn).toBe(false);
    expect(result.reasoning).toBe('not json or markdown at all');
  });

  it('parse_synthesis_result rejects legacy direct skill JSON', () => {
    const result = parse_synthesis_result('{"id":"legacy","name":"Legacy Skill","task_type":"git","steps":["a"],"pitfalls":["b"],"trigger_condition":"x"}');
    expect(result.should_learn).toBe(false);
    expect(result.skill).toEqual({});
    expect(result.document).toBeUndefined();
  });

  it('synthesize_skill asks provider for SKILL.md and parses provider output', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      chat: vi.fn(async () => ({
        content: skillMarkdown,
        finish_reason: 'stop',
      })),
      chat_stream: vi.fn(),
      get_model: () => 'mock-model',
    };

    const result = await synthesize_skill(
      {
        task_buffer: [makeEntry('git', ['Read', 'run_shell'])],
        last_task_type: 'git',
      },
      provider,
      { match: () => null, fuzzy_match: () => [] },
    );

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect((provider.chat as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0][0].content).toContain('完整的 SKILL.md');
    expect(result.should_learn).toBe(true);
    expect(result.document?.manifest.id).toBe('git-status-review');
  });
});
