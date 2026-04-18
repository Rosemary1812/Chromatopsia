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

  it('parse_synthesis_result parses valid JSON skill object', () => {
    const json = JSON.stringify({
      should_learn: true,
      confidence: 0.91,
      reasoning: 'repeated workflow',
      skill: {
        id: 'skill-1',
        name: 'Test Skill',
        task_type: 'test',
        steps: ['step1', 'step2'],
        pitfalls: ['pitfall1'],
        trigger_condition: 'test condition',
      },
    });
    const result = parse_synthesis_result(json);
    expect(result.skill).toBeDefined();
    expect((result.skill as { name?: string }).name).toBe('Test Skill');
    expect(result.should_learn).toBe(true);
    expect(result.confidence).toBe(0.91);
  });

  it('parse_synthesis_result extracts JSON from markdown code block', () => {
    const content = 'Some text\n```json\n{"should_learn":true,"skill":{"id":"s1","name":"S"}}\n```\nMore text';
    const result = parse_synthesis_result(content);
    expect((result.skill as { name?: string }).name).toBe('S');
  });

  it('parse_synthesis_result returns empty skill on invalid JSON', () => {
    const result = parse_synthesis_result('not json at all');
    expect(result.skill).toEqual({});
    expect(result.should_learn).toBe(false);
    expect(result.reasoning).toBe('not json at all');
  });

  it('parse_synthesis_result returns empty skill for empty object', () => {
    const result = parse_synthesis_result('{}');
    expect(result.skill).toEqual({});
    expect(result.should_learn).toBe(false);
  });

  it('parse_synthesis_result remains backward compatible with direct skill JSON', () => {
    const result = parse_synthesis_result('{"id":"legacy","name":"Legacy Skill","task_type":"git","steps":["a"],"pitfalls":["b"],"trigger_condition":"x"}');
    expect(result.should_learn).toBe(true);
    expect((result.skill as { id?: string }).id).toBe('legacy');
  });

  it('synthesize_skill uses learning input and provider output', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      chat: vi.fn(async () => ({
        content: '{"should_learn":true,"confidence":0.88,"skill":{"id":"draft-1","name":"Draft 1","task_type":"git","steps":["a","b","c"],"pitfalls":["x","y"],"trigger_condition":"git work"}}',
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
    expect(result.should_learn).toBe(true);
    expect(result.confidence).toBe(0.88);
    expect((result.skill as { id?: string }).id).toBe('draft-1');
  });
});
