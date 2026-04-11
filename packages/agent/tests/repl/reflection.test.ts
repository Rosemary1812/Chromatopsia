/**
 * Unit tests for repl/reflection.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  create_reflection_state,
  update_last_active,
  add_to_task_buffer,
  should_trigger_reflection,
  reset_reflection,
  start_reflection,
  run_idle_reflection,
  summarize_task_buffer,
  parse_synthesis_result,
} from '../../src/repl/reflection.js';
import type { ReflectionState, TaskBufferEntry } from '../../src/types.js';

const makeEntry = (task_type: string, tool_names: string[]): TaskBufferEntry => ({
  tool_calls: tool_names.map((name, i) => ({ id: `tc-${i}`, name, arguments: {} })),
  tool_results: tool_names.map((_, i) => ({ tool_call_id: `tc-${i}`, output: 'ok', success: true })),
  task_type,
  session_id: 'test-session',
  timestamp: Date.now(),
});

describe('repl/reflection', () => {
  describe('create_reflection_state', () => {
    it('should create initial state with defaults', () => {
      const state = create_reflection_state();
      expect(state.in_progress).toBe(false);
      expect(state.task_buffer).toEqual([]);
      expect(state.trigger_count).toBe(0);
      expect(state.last_task_type).toBe(null);
      expect(typeof state.last_active_at).toBe('number');
    });
  });

  describe('update_last_active', () => {
    it('should update last_active_at timestamp', async () => {
      const state = create_reflection_state();
      const before = state.last_active_at;
      await new Promise((r) => setTimeout(r, 10));
      update_last_active(state);
      expect(state.last_active_at).toBeGreaterThan(before);
    });
  });

  describe('add_to_task_buffer', () => {
    it('should add entry to buffer', () => {
      const state = create_reflection_state();
      const entry = makeEntry('git-commit', ['run_shell', 'Read']);
      add_to_task_buffer(state, entry);
      expect(state.task_buffer).toHaveLength(1);
      expect(state.trigger_count).toBe(1);
      expect(state.last_task_type).toBe('git-commit');
    });

    it('should increment trigger_count for same task_type', () => {
      const state = create_reflection_state();
      add_to_task_buffer(state, makeEntry('git-commit', ['run_shell']));
      add_to_task_buffer(state, makeEntry('git-commit', ['Read']));
      add_to_task_buffer(state, makeEntry('git-commit', ['Grep']));
      expect(state.trigger_count).toBe(3);
      expect(state.task_buffer).toHaveLength(3);
    });

    it('should reset trigger_count when task_type changes', () => {
      const state = create_reflection_state();
      add_to_task_buffer(state, makeEntry('git-commit', ['run_shell']));
      add_to_task_buffer(state, makeEntry('git-commit', ['Read']));
      add_to_task_buffer(state, makeEntry('test-debug', ['run_shell']));
      expect(state.trigger_count).toBe(1);
      expect(state.last_task_type).toBe('test-debug');
    });

    it('should evict oldest entry when exceeding max buffer size', () => {
      const state = create_reflection_state();
      for (let i = 0; i < 55; i++) {
        add_to_task_buffer(state, makeEntry('test', ['run_shell']));
      }
      expect(state.task_buffer).toHaveLength(50);
    });
  });

  describe('should_trigger_reflection', () => {
    it('should return false if task_type differs', () => {
      const state = create_reflection_state();
      state.last_task_type = 'git-commit';
      state.trigger_count = 3;
      expect(should_trigger_reflection(state, 'test-debug', 3)).toBe(false);
    });

    it('should return true when trigger_count >= threshold', () => {
      const state = create_reflection_state();
      state.last_task_type = 'git-commit';
      state.trigger_count = 3;
      expect(should_trigger_reflection(state, 'git-commit', 3)).toBe(true);
    });

    it('should return false when trigger_count < threshold', () => {
      const state = create_reflection_state();
      state.last_task_type = 'git-commit';
      state.trigger_count = 2;
      expect(should_trigger_reflection(state, 'git-commit', 3)).toBe(false);
    });
  });

  describe('reset_reflection', () => {
    it('should clear buffer and reset counters', () => {
      const state = create_reflection_state();
      state.task_buffer.push(makeEntry('git-commit', ['run_shell']));
      state.trigger_count = 3;
      state.in_progress = true;
      const reset = reset_reflection(state);
      expect(reset.task_buffer).toEqual([]);
      expect(reset.trigger_count).toBe(0);
      expect(reset.in_progress).toBe(false);
      expect(reset.last_active_at).toBe(state.last_active_at); // 不变
    });
  });

  describe('start_reflection', () => {
    it('should set in_progress to true', () => {
      const state = create_reflection_state();
      expect(state.in_progress).toBe(false);
      start_reflection(state);
      expect(state.in_progress).toBe(true);
    });
  });

  describe('run_idle_reflection', () => {
    it('should return null when in_progress is true', async () => {
      const state = create_reflection_state();
      state.in_progress = true;
      const result = await run_idle_reflection(state, 0);
      expect(result).toBe(null);
    });

    it('should return null when idle_timeout not reached', async () => {
      const state = create_reflection_state();
      state.last_active_at = Date.now(); // just now
      state.task_buffer.push(makeEntry('test', ['run_shell']));
      const result = await run_idle_reflection(state, 30_000);
      expect(result).toBe(null);
    });

    it('should return null when task_buffer is empty', async () => {
      const state = create_reflection_state();
      state.last_active_at = Date.now() - 60_000;
      const result = await run_idle_reflection(state, 30_000);
      expect(result).toBe(null);
    });
  });

  describe('summarize_task_buffer', () => {
    it('should return (empty) for empty buffer', () => {
      expect(summarize_task_buffer([])).toBe('(empty)');
    });

    it('should format entries with tool names', () => {
      const buffer = [makeEntry('git-commit', ['run_shell', 'Read'])];
      const summary = summarize_task_buffer(buffer);
      expect(summary).toContain('git-commit');
      expect(summary).toContain('run_shell');
      expect(summary).toContain('Read');
    });
  });

  describe('parse_synthesis_result', () => {
    it('should parse valid JSON skill object', () => {
      const json = JSON.stringify({
        id: 'skill-1',
        name: 'Test Skill',
        task_type: 'test',
        steps: ['step1', 'step2'],
        pitfalls: ['pitfall1'],
        trigger_condition: 'test condition',
      });
      const result = parse_synthesis_result(json);
      expect(result.skill).toBeDefined();
      expect((result.skill as any).name).toBe('Test Skill');
      expect(result.reasoning).toBe('');
    });

    it('should extract JSON from markdown code block', () => {
      const content = 'Some text\n```json\n{"id":"s1","name":"S"}\n```\nMore text';
      const result = parse_synthesis_result(content);
      expect((result.skill as any).name).toBe('S');
    });

    it('should return empty skill on invalid JSON', () => {
      const result = parse_synthesis_result('not json at all');
      expect(result.skill).toEqual({});
      expect(result.reasoning).toBe('not json at all');
    });

    it('should return empty skill for empty object', () => {
      const result = parse_synthesis_result('{}');
      expect(result.skill).toEqual({});
    });
  });
});
