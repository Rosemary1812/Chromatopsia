import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider, Session } from '../../src/foundation/types.js';
import { createLearningTurnHook, loadMemorySystemMessages, persistTurnMemory } from '../../src/repl/turn-hooks.js';
import * as memoryInjectorModule from '../../src/memory/injector.js';
import * as memoryWriterModule from '../../src/memory/writer.js';

describe('repl/turn-hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty memory system messages on injection failure', async () => {
    vi.spyOn(memoryInjectorModule, 'buildMemoryInjection').mockRejectedValue(new Error('boom'));

    const result = await loadMemorySystemMessages(
      'hello',
      {} as never,
      {} as never,
    );

    expect(result).toEqual([]);
  });

  it('swallows memory persistence errors', async () => {
    vi.spyOn(memoryWriterModule, 'maybeWriteMemory').mockRejectedValue(new Error('boom'));

    await expect(persistTurnMemory(
      'hello',
      { messages: [] } as Session,
      {} as LLMProvider,
      {} as never,
      {} as never,
    )).resolves.toBeUndefined();
  });

  it('emits draft generation and reminder notifications with session cap', async () => {
    const emitRuntime = vi.fn();
    const learningHook = createLearningTurnHook({
      learningWorker: {
        onTurnCompleted: vi
          .fn()
          .mockResolvedValueOnce({ triggered: true, draftName: 'Draft A' })
          .mockResolvedValueOnce({ triggered: false }),
      } as never,
      skillStore: {
        list_drafts: vi.fn(() => [{ id: 'd1' }]),
      } as never,
      reminderEnabled: true,
      reminderMaxPerSession: 1,
      emitRuntime,
    });

    await learningHook('general', 'hello');
    await learningHook('general', 'world');

    expect(emitRuntime).toHaveBeenNthCalledWith(1, {
      type: 'notification',
      message: 'Draft skill generated: Draft A',
    });
    expect(emitRuntime).toHaveBeenNthCalledWith(2, {
      type: 'notification',
      message: '[Learning] 1 draft(s) pending review',
    });
    expect(emitRuntime).toHaveBeenCalledTimes(2);
  });

  it('forwards tool payload into LearningWorker', async () => {
    const onTurnCompleted = vi.fn(async () => ({ triggered: false }));
    const learningHook = createLearningTurnHook({
      learningWorker: {
        onTurnCompleted,
      } as never,
      skillStore: {
        list_drafts: vi.fn(() => []),
      } as never,
      reminderEnabled: false,
      reminderMaxPerSession: 1,
      emitRuntime: vi.fn(),
    });

    await learningHook('git', 'check repo', {
      tool_calls: [{ id: 'tc1', name: 'run_shell', arguments: { command: 'git status' } }],
      tool_results: [{ tool_call_id: 'tc1', output: 'clean', success: true }],
    });

    expect(onTurnCompleted).toHaveBeenCalledWith('git', 'check repo', expect.objectContaining({
      tool_calls: expect.any(Array),
      tool_results: expect.any(Array),
    }));
  });
});
