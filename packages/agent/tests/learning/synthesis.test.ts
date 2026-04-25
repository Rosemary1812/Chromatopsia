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
    const entry = makeEntry('git-commit', ['run_shell', 'Read']);
    entry.tool_call_count = 5;
    entry.used_skill_ids = ['git-skill'];
    entry.matched_skill_ids = ['git-skill'];
    entry.error_count = 1;
    entry.final_outcome = 'failed';
    entry.task_complexity_signal = 'complex';
    const summary = summarize_task_buffer([entry]);
    expect(summary).toContain('git-commit');
    expect(summary).toContain('run_shell');
    expect(summary).toContain('Read');
    expect(summary).toContain('tool_count=5');
    expect(summary).toContain('errors=1');
    expect(summary).toContain('outcome=failed');
    expect(summary).toContain('complexity=complex');
    expect(summary).toContain('used_skills=git-skill');
  });

  it('parse_synthesis_result rejects raw SKILL.md guidance outside strict JSON', () => {
    const result = parse_synthesis_result(skillMarkdown);
    expect(result.should_learn).toBe(false);
    expect(result.document).toBeUndefined();
  });

  it('parse_synthesis_result parses skip JSON', () => {
    const result = parse_synthesis_result('{"decision":"skip","confidence":0.4,"reasoning":"not reusable"}');
    expect(result.skill).toEqual({});
    expect(result.should_learn).toBe(false);
    expect(result.decision).toBe('skip');
    expect(result.confidence).toBe(0.4);
    expect(result.reasoning).toBe('not reusable');
  });

  it('parse_synthesis_result parses create JSON with skill_markdown', () => {
    const result = parse_synthesis_result(JSON.stringify({
      decision: 'create',
      confidence: 0.9,
      reasoning: 'reusable workflow',
      evidence: ['two successful tool-backed turns'],
      risk_notes: ['could be too git-specific'],
      target_skill_id: null,
      skill_markdown: skillMarkdown,
    }));
    expect(result.should_learn).toBe(true);
    expect(result.decision).toBe('create');
    expect(result.confidence).toBe(0.9);
    expect(result.document?.manifest.id).toBe('git-status-review');
    expect(result.evidence).toEqual(['two successful tool-backed turns']);
  });

  it('parse_synthesis_result parses patch JSON with patch metadata', () => {
    const result = parse_synthesis_result(JSON.stringify({
      decision: 'patch',
      confidence: 0.88,
      reasoning: 'existing skill missed verification',
      target_skill_id: 'existing-git-skill',
      patch_plan: 'Add verification guidance.',
      skill_markdown: skillMarkdown,
    }));
    expect(result.should_learn).toBe(true);
    expect(result.decision).toBe('patch');
    expect(result.target_skill_id).toBe('existing-git-skill');
    expect(result.patch_plan).toBe('Add verification guidance.');
    expect(result.document?.body).toContain('## Verification');
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

  it('synthesize_skill asks provider for strict JSON and parses provider output', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'create',
          confidence: 0.9,
          reasoning: 'reusable workflow',
          target_skill_id: null,
          evidence: ['tool-backed workflow'],
          risk_notes: [],
          skill_markdown: skillMarkdown,
        }),
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
    expect((provider.chat as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0][0].content).toContain('Return strict JSON only');
    expect(result.should_learn).toBe(true);
    expect(result.decision).toBe('create');
    expect(result.document?.manifest.id).toBe('git-status-review');
  });
});
