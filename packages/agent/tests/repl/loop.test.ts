// T-24: tests/repl/loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider, LLMResponse, Session, Message } from '../../src/foundation/types.js';
import { run_repl } from '../../src/repl/loop.js';
import * as llmIndex from '../../src/foundation/llm/index.js';
import * as sessionModule from '../../src/agent/session/manager.js';
import * as slashModule from '../../src/repl/slash.js';
import * as executorModule from '../../src/repl/executor.js';
import * as skillRegistryModule from '../../src/skills/registry.js';
import * as skillStoreModule from '../../src/skills/store.js';
import * as hooksApprovalModule from '../../src/hooks/approval.js';
import * as learningWorkerModule from '../../src/learning/worker.js';

function create_mock_session(): Session {
  const messages: Message[] = [];
  return {
    id: 'test-session',
    messages,
    working_directory: '/tmp',
    created_at: Date.now(),
    last_active: Date.now(),
    add_message: (msg: Message) => {
      messages.push(msg);
    },
    clear: vi.fn(() => {
      messages.splice(0);
    }),
    compact: vi.fn(),
  } as unknown as Session;
}

let mock_llm_responses: Partial<LLMResponse>[] = [];
let mock_chat_stream_calls = 0;

function create_mock_provider(): LLMProvider {
  mock_chat_stream_calls = 0;
  return {
    name: 'mock',
    chat: vi.fn(async () => mock_llm_responses[0] ?? { content: '' }),
    chat_stream: vi.fn(async function* () {
      const idx = mock_chat_stream_calls++;
      const resp = mock_llm_responses[idx] ?? { content: '' };
      if (resp.content) {
        for (const char of resp.content) {
          yield char;
        }
      }
    }),
    get_model: () => 'mock-model',
  };
}

function create_mock_rl() {
  return {
    question: vi.fn((_prompt: string, _cb: (ans: string) => void) => {
      // tests call handle_user_input directly
    }),
    close: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'close') cb();
      return this;
    }),
    prompt: vi.fn(),
  };
}

function setup_common_mocks(session: Session, provider: LLMProvider) {
  vi.spyOn(llmIndex, 'createProvider').mockReturnValue(
    provider as unknown as ReturnType<typeof llmIndex.createProvider>,
  );
  vi.spyOn(sessionModule, 'SessionManager').mockReturnValue({
    create_session: vi.fn(() => session),
    get_session: vi.fn(() => session),
    get_history: vi.fn(() => ({ load_session: vi.fn(async () => session.messages) })),
  } as unknown as sessionModule.SessionManager);
  vi.spyOn(skillRegistryModule, 'SkillRegistry').mockReturnValue({
    trigger_match: vi.fn(() => null),
    match: vi.fn(() => null),
    fuzzy_match: vi.fn(() => []),
    register: vi.fn(),
    register_manifest: vi.fn(),
    build_directory_listing: vi.fn(() => ''),
    list: vi.fn(),
    show: vi.fn(),
    delete: vi.fn(),
    search: vi.fn(),
  } as unknown as skillRegistryModule.SkillRegistry);
  vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({
    load: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    save_draft: vi.fn(async () => {}),
    list_drafts: vi.fn(() => []),
    approve_draft: vi.fn(async () => null),
    reject_draft: vi.fn(async () => false),
    getAll: vi.fn(() => []),
    getManifest: vi.fn(() => []),
    delete: vi.fn(async () => {}),
  } as unknown as skillStoreModule.SkillStore);
  vi.spyOn(hooksApprovalModule, 'ApprovalHook').mockImplementation(
    () =>
      ({
        request_approval: vi.fn(() => null),
        wait_for_decision: vi.fn(async () => ({ request_id: '', decision: 'approve' as const })),
        submit_decision: vi.fn(),
      }) as unknown as hooksApprovalModule.ApprovalHook,
  );
  vi.spyOn(learningWorkerModule, 'LearningWorker').mockImplementation(
    () =>
      ({
        onTurnCompleted: vi.fn(async () => ({ triggered: false })),
      }) as unknown as learningWorkerModule.LearningWorker,
  );
  vi.spyOn(executorModule, 'execute_tool_calls_parallel').mockResolvedValue([]);
  vi.spyOn(executorModule, 'execute_skill').mockResolvedValue([]);
  vi.spyOn(slashModule, 'handle_slash_command').mockReturnValue(false);
}

describe('repl/loop — learning decoupled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock_llm_responses = [];
  });

  it('adds user message to session', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    mock_llm_responses = [{ content: 'Hello!', finish_reason: 'stop' }];
    setup_common_mocks(session, provider);

    const repl = await run_repl({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      readline_interface: create_mock_rl() as unknown as import('node:readline').Interface,
    });

    await repl.handle_user_input('hello');
    expect(session.messages.some((m) => m.role === 'user' && m.content === 'hello')).toBe(true);
  });

  it('adds assistant reply after LLM response', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    mock_llm_responses = [{ content: 'Hello, how can I help?', finish_reason: 'stop' }];
    setup_common_mocks(session, provider);

    const repl = await run_repl({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      readline_interface: create_mock_rl() as unknown as import('node:readline').Interface,
    });

    await repl.handle_user_input('hello');
    expect(session.messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('executes skill when trigger_match returns skill', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    setup_common_mocks(session, provider);

    vi.spyOn(skillRegistryModule, 'SkillRegistry').mockReturnValue({
      trigger_match: vi.fn(() => ({
        id: 'skill-1',
        name: 'Test Skill',
        trigger_condition: 'test',
        steps: ['Read file_path=/tmp/test.txt'],
        pitfalls: [],
        task_type: 'test',
        created_at: Date.now(),
        updated_at: Date.now(),
        call_count: 0,
        success_count: 0,
      })),
      match: vi.fn(() => null),
      fuzzy_match: vi.fn(() => []),
      register: vi.fn(),
      register_manifest: vi.fn(),
      build_directory_listing: vi.fn(() => ''),
      list: vi.fn(),
      show: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
    } as unknown as skillRegistryModule.SkillRegistry);

    const execute_skill_spy = vi
      .spyOn(executorModule, 'execute_skill')
      .mockResolvedValue([{ tool_call_id: 'x', output: 'ok', success: true }]);

    const repl = await run_repl({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      readline_interface: create_mock_rl() as unknown as import('node:readline').Interface,
    });

    await repl.handle_user_input('test trigger');
    expect(execute_skill_spy).toHaveBeenCalled();
    expect(provider.chat_stream).not.toHaveBeenCalled();
  });
});

