import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvents, LLMProvider, LLMResponse, Message, RuntimeEvent, RuntimeSink, Session } from '../../src/foundation/types.js';
import { create_agent_runtime } from '../../src/repl/loop.js';
import { createRuntimeEvent, createRuntimeSinkFromAgentEvents } from '../../src/repl/runtime.js';
import * as llmIndex from '../../src/foundation/llm/index.js';
import * as sessionModule from '../../src/session/manager.js';
import * as skillRegistryModule from '../../src/skills/registry.js';
import * as skillStoreModule from '../../src/skills/store.js';
import * as hooksApprovalModule from '../../src/hooks/approval.js';
import * as learningWorkerModule from '../../src/learning/worker.js';
import * as executorModule from '../../src/repl/executor.js';
import * as slashModule from '../../src/repl/slash.js';
import * as storagePathsModule from '../../src/storage/paths.js';

function create_mock_session(): Session {
  const messages: Message[] = [];
  return {
    id: 'runtime-session',
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
      return {
        content: resp.content ?? '',
        tool_calls: resp.tool_calls,
        finish_reason: resp.finish_reason ?? (resp.tool_calls?.length ? 'tool_use' : 'stop'),
      };
    }),
    get_model: () => 'mock-model',
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
  } as unknown as skillRegistryModule.SkillRegistry);
  vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({
    load: vi.fn(async () => {}),
    list_drafts: vi.fn(() => []),
    approve_draft: vi.fn(async () => null),
    reject_draft: vi.fn(async () => false),
    getAll: vi.fn(() => []),
    getManifest: vi.fn(() => []),
  } as unknown as skillStoreModule.SkillStore);
  vi.spyOn(hooksApprovalModule, 'ApprovalHook').mockImplementation(
    () =>
      ({
        request_approval: vi.fn(() => null),
        wait_for_decision: vi.fn(async () => ({ request_id: '', decision: 'approve' as const })),
      }) as unknown as hooksApprovalModule.ApprovalHook,
  );
  vi.spyOn(learningWorkerModule, 'LearningWorker').mockImplementation(
    () =>
      ({
        onTurnCompleted: vi.fn(async () => ({ triggered: false })),
      }) as unknown as learningWorkerModule.LearningWorker,
  );
  vi.spyOn(executorModule, 'execute_skill').mockResolvedValue([]);
  vi.spyOn(slashModule, 'handle_slash_command').mockReturnValue(false);
}

describe('repl/runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock_llm_responses = [];
  });

  it('wires runtime stores to project-local storage paths', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    setup_common_mocks(session, provider);

    const storagePaths = {
      projectRoot: '/repo',
      root: '/repo/.chromatopsia',
      sessionsDir: '/repo/.chromatopsia/sessions',
      sessionsIndexPath: '/repo/.chromatopsia/sessions/index.json',
      learningDir: '/repo/.chromatopsia/learning',
      turnEventsPath: '/repo/.chromatopsia/learning/turn-events.jsonl',
      learningStatePath: '/repo/.chromatopsia/learning/state.json',
      memoryDir: '/repo/.chromatopsia/memory',
      memoryIndexPath: '/repo/.chromatopsia/memory/MEMORY.md',
      skillsDir: '/repo/.chromatopsia/skills',
      skillsIndexPath: '/repo/.chromatopsia/skills/index.json',
      userSkillsDir: '/repo/.chromatopsia/skills/user',
      draftSkillsDir: '/repo/.chromatopsia/skills/drafts',
      logsDir: '/repo/.chromatopsia/logs',
      builtinSkillsRoots: ['/repo/packages/agent/skills/builtin'],
    };

    vi.spyOn(storagePathsModule, 'resolveStoragePaths').mockReturnValue(storagePaths as ReturnType<typeof storagePathsModule.resolveStoragePaths>);
    await create_agent_runtime({
      working_dir: '/repo/packages/agent',
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime: { emit: vi.fn() },
    });

    expect(storagePathsModule.resolveStoragePaths).toHaveBeenCalled();
    expect(sessionModule.SessionManager).toHaveBeenCalledWith('/repo/.chromatopsia/sessions', expect.anything());
    expect(skillStoreModule.SkillStore).toHaveBeenCalledWith(expect.objectContaining({
      indexPath: '/repo/.chromatopsia/skills/index.json',
      runtimeSkillsRoot: '/repo/.chromatopsia/skills',
    }));
  });

  it('maps runtime events back to AgentEvents callbacks', async () => {
    const onTurnComplete = vi.fn();
    const onStreamChunk = vi.fn();
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const onToolBatchEnd = vi.fn();
    const onError = vi.fn();
    const onNotification = vi.fn();
    const onDebug = vi.fn();
    const onApprovalRequest = vi.fn(async (request) => ({
      request_id: request.id,
      decision: 'approve' as const,
    }));

    const sink = createRuntimeSinkFromAgentEvents({
      onTurnComplete,
      onStreamChunk,
      onToolStart,
      onToolEnd,
      onToolBatchEnd,
      onError,
      onNotification,
      onDebug,
      onApprovalRequest,
    } satisfies AgentEvents);

    sink.emit(createRuntimeEvent({ type: 'assistant_chunk', turnId: 't1', chunk: 'x' }, { agentId: 'main', agentRole: 'main' }));
    sink.emit(createRuntimeEvent({ type: 'assistant_message', turnId: 't1', content: 'done', toolCalls: [{ id: 'tc-1', name: 'Read', arguments: {} }] }, { agentId: 'main', agentRole: 'main' }));
    sink.emit(createRuntimeEvent({ type: 'turn_completed', turnId: 't1', content: 'done' }, { agentId: 'main', agentRole: 'main' }));
    sink.emit(createRuntimeEvent({ type: 'notification', message: 'hello' }, { agentId: 'main', agentRole: 'main' }));
    sink.emit(createRuntimeEvent({ type: 'debug', message: 'dbg' }, { agentId: 'main', agentRole: 'main' }));
    sink.emit(createRuntimeEvent({ type: 'error', message: 'err' }, { agentId: 'main', agentRole: 'main' }));

    await sink.requestApproval?.({
      id: 'req-1',
      tool_name: 'run_shell',
      args: {},
      context: 'tool execution',
      timestamp: Date.now(),
    });

    expect(onStreamChunk).toHaveBeenCalledWith('x');
    expect(onTurnComplete).toHaveBeenCalledWith('done', [{ id: 'tc-1', name: 'Read', arguments: {} }]);
    expect(onNotification).toHaveBeenCalledWith('hello');
    expect(onDebug).toHaveBeenCalledWith('dbg');
    expect(onError).toHaveBeenCalledWith('err');
    expect(onApprovalRequest).toHaveBeenCalledTimes(1);
    expect(onToolStart).not.toHaveBeenCalled();
    expect(onToolEnd).not.toHaveBeenCalled();
    expect(onToolBatchEnd).not.toHaveBeenCalled();
  });

  it('emits runtime events for a normal assistant turn', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    mock_llm_responses = [{ content: 'Hello!', finish_reason: 'stop' }];
    setup_common_mocks(session, provider);

    const events: RuntimeEvent[] = [];
    const runtime: RuntimeSink = {
      emit: (event) => {
        events.push(event);
      },
      requestApproval: vi.fn(async (request) => ({
        request_id: request.id,
        decision: 'approve',
      })),
    };

    const agentRuntime = await create_agent_runtime({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime,
      agentId: 'main',
      agentRole: 'main',
    });

    await agentRuntime.handle_user_input('hello');

    expect(events[0]?.type).toBe('turn_started');
    expect(events.some((event) => event.type === 'assistant_chunk')).toBe(true);
    expect(events.some((event) => event.type === 'assistant_message')).toBe(true);
    expect(events.some((event) => event.type === 'turn_completed')).toBe(true);
    expect(events.every((event) => event.agentId === 'main')).toBe(true);
  });
});
