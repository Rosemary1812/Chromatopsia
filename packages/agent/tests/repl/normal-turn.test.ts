import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider, LLMResponse, Message, Session, ToolCall } from '../../src/foundation/types.js';
import { handle_normal_turn } from '../../src/repl/normal-turn.js';

function createSession(): Session {
  const messages: Message[] = [];
  return {
    id: 'session-1',
    messages,
    working_directory: '/tmp',
    created_at: Date.now(),
    last_active: Date.now(),
    add_message: (msg: Message) => messages.push(msg),
    clear: vi.fn(),
    compact: vi.fn(),
  } as unknown as Session;
}

function createProvider(responses: Array<Partial<LLMResponse>>): LLMProvider {
  let calls = 0;
  return {
    name: 'mock',
    chat: vi.fn(),
    chat_stream: vi.fn(async function* () {
      const response = responses[calls++] ?? { content: '', finish_reason: 'stop' };
      if (response.content) {
        yield response.content;
      }
      return {
        content: response.content ?? '',
        tool_calls: response.tool_calls,
        finish_reason: response.finish_reason ?? (response.tool_calls?.length ? 'tool_use' : 'stop'),
      };
    }),
    get_model: () => 'mock-model',
  };
}

describe('repl/normal-turn learning signals', () => {
  it('records Skill tool calls in the execution summary', async () => {
    const skillToolCall: ToolCall = {
      id: 'tc-skill',
      name: 'Skill',
      arguments: { name: 'git-review', args: 'inspect repo' },
    };
    const summary = await handle_normal_turn({
      taskType: 'git',
      session: createSession(),
      provider: createProvider([
        { content: 'loading skill', tool_calls: [skillToolCall], finish_reason: 'tool_use' },
        { content: 'done', finish_reason: 'stop' },
      ]),
      skillRegistry: { build_directory_listing: vi.fn(() => '') } as never,
      approvalHook: { request_approval: vi.fn(() => null), wait_for_decision: vi.fn() } as never,
      toolContext: { session: createSession(), working_directory: '/tmp' },
      isDebug: false,
      runtime: { emit: vi.fn() },
      turnId: 'turn-1',
      runtimeMetadata: { agentId: 'main' },
    });

    expect(summary.toolCallCount).toBe(1);
    expect(summary.usedSkillIds).toEqual(['git-review']);
    expect(summary.skillLoads).toEqual(['git-review']);
    expect(summary.taskComplexitySignal).toBe('simple');
  });
});
