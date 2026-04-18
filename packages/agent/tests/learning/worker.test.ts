import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider, Session, ToolCall, ToolResult, TurnEvent } from '../../src/foundation/types.js';
import { LearningWorker } from '../../src/learning/worker.js';

function createSession(): Session {
  return {
    id: 'session-1',
    messages: [],
    working_directory: '/tmp',
    created_at: Date.now(),
    last_active: Date.now(),
    add_message: vi.fn(),
    clear: vi.fn(),
    compact: vi.fn(),
  } as unknown as Session;
}

function createProvider(content: string): LLMProvider {
  return {
    name: 'mock',
    chat: vi.fn(async () => ({
      content,
      finish_reason: 'stop',
    })),
    chat_stream: vi.fn(),
    get_model: () => 'mock-model',
  };
}

function makeEvent(overrides: Partial<TurnEvent> = {}): TurnEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    session_id: 'session-1',
    timestamp: Date.now(),
    task_type: 'git',
    user_input: 'check git status',
    tool_calls: [],
    tool_results: [],
    ...overrides,
  };
}

const toolCall: ToolCall = { id: 'tc-1', name: 'run_shell', arguments: { command: 'git status' } };
const toolResult: ToolResult = { tool_call_id: 'tc-1', output: 'clean', success: true };

describe('learning/worker', () => {
  it('appends real tool calls and results to turn events', async () => {
    const append = vi.fn(async () => {});
    const eventStore = {
      append,
      incrementSessionTurns: vi.fn(async () => 1),
      recentBySession: vi.fn(),
      resetSessionTurns: vi.fn(),
    };

    const worker = new LearningWorker({
      provider: createProvider('{}'),
      session: createSession(),
      skillStore: { save_draft: vi.fn() } as never,
      skillRegistry: { match: vi.fn(() => null), fuzzy_match: vi.fn(() => []) } as never,
      eventStore: eventStore as never,
    }, 20, 0.75);

    await worker.onTurnCompleted('git', 'check repo', {
      tool_calls: [toolCall],
      tool_results: [toolResult],
    });

    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      task_type: 'git',
      user_input: 'check repo',
      tool_calls: [toolCall],
      tool_results: [toolResult],
    }));
  });

  it('only considers recent batch tool activity before running synthesis', async () => {
    const provider = createProvider('{"should_learn":true,"confidence":0.9,"skill":{"id":"s1","name":"Skill","task_type":"git","steps":["a","b","c"],"pitfalls":["x","y"],"trigger_condition":"git"}}');
    const eventStore = {
      append: vi.fn(async () => {}),
      incrementSessionTurns: vi.fn(async () => 2),
      recentBySession: vi.fn(async () => [
        makeEvent({ tool_calls: [toolCall], tool_results: [toolResult] }),
        makeEvent(),
      ]),
      resetSessionTurns: vi.fn(async () => {}),
    };

    const worker = new LearningWorker({
      provider,
      session: createSession(),
      skillStore: { save_draft: vi.fn() } as never,
      skillRegistry: { match: vi.fn(() => null), fuzzy_match: vi.fn(() => []) } as never,
      eventStore: eventStore as never,
    }, 2, 0.75);

    const result = await worker.onTurnCompleted('git', 'check repo');

    expect(result.triggered).toBe(false);
    expect(provider.chat).not.toHaveBeenCalled();
    expect(eventStore.resetSessionTurns).not.toHaveBeenCalled();
  });

  it('does not reset turn counter when synthesis does not produce an approved draft', async () => {
    const provider = createProvider('{"should_learn":false,"confidence":0.4,"reasoning":"not reusable","skill":{}}');
    const saveDraft = vi.fn(async () => {});
    const eventStore = {
      append: vi.fn(async () => {}),
      incrementSessionTurns: vi.fn(async () => 2),
      recentBySession: vi.fn(async () => [
        makeEvent({ tool_calls: [toolCall], tool_results: [toolResult] }),
        makeEvent({ tool_calls: [toolCall], tool_results: [toolResult] }),
      ]),
      resetSessionTurns: vi.fn(async () => {}),
    };

    const worker = new LearningWorker({
      provider,
      session: createSession(),
      skillStore: { save_draft: saveDraft } as never,
      skillRegistry: { match: vi.fn(() => null), fuzzy_match: vi.fn(() => []) } as never,
      eventStore: eventStore as never,
    }, 2, 0.75);

    const result = await worker.onTurnCompleted('git', 'check repo');

    expect(result.triggered).toBe(false);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(eventStore.resetSessionTurns).not.toHaveBeenCalled();
  });
});
