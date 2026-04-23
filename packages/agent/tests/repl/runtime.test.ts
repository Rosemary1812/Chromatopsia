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
import * as slashModule from '../../src/repl/slash.js';
import * as storagePathsModule from '../../src/storage/paths.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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
        token_usage: resp.token_usage,
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

  it('passes approval config into ApprovalHook', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    setup_common_mocks(session, provider);

    await create_agent_runtime({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      app_config: {
        provider: 'anthropic',
        anthropic: { api_key: 'test' },
        approval: {
          auto_approve_safe: false,
          timeout_seconds: 42,
        },
      },
      runtime: { emit: vi.fn() },
    });

    expect(hooksApprovalModule.ApprovalHook).toHaveBeenCalledWith(expect.objectContaining({
      auto_approve_safe: false,
      timeout_ms: 42000,
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

  it('records token usage into trace logger for completed turns', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    mock_llm_responses = [{
      content: 'Hello!',
      finish_reason: 'stop',
      token_usage: {
        input: 123,
        output: 45,
        cache_creation: 67,
        cache_read: 8,
      },
    }];
    setup_common_mocks(session, provider);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-token-test-'));
    vi.spyOn(storagePathsModule, 'resolveStoragePaths').mockReturnValue({
      projectRoot: tempRoot,
      root: path.join(tempRoot, '.chromatopsia'),
      sessionsDir: path.join(tempRoot, '.chromatopsia', 'sessions'),
      sessionsIndexPath: path.join(tempRoot, '.chromatopsia', 'sessions', 'index.json'),
      learningDir: path.join(tempRoot, '.chromatopsia', 'learning'),
      turnEventsPath: path.join(tempRoot, '.chromatopsia', 'learning', 'turn-events.jsonl'),
      learningStatePath: path.join(tempRoot, '.chromatopsia', 'learning', 'state.json'),
      memoryDir: path.join(tempRoot, '.chromatopsia', 'memory'),
      memoryIndexPath: path.join(tempRoot, '.chromatopsia', 'memory', 'MEMORY.md'),
      skillsDir: path.join(tempRoot, '.chromatopsia', 'skills'),
      skillsIndexPath: path.join(tempRoot, '.chromatopsia', 'skills', 'index.json'),
      userSkillsDir: path.join(tempRoot, '.chromatopsia', 'skills', 'user'),
      draftSkillsDir: path.join(tempRoot, '.chromatopsia', 'skills', 'drafts'),
      logsDir: path.join(tempRoot, '.chromatopsia', 'logs'),
      builtinSkillsRoots: [path.join(tempRoot, 'skills', 'builtin')],
    } as ReturnType<typeof storagePathsModule.resolveStoragePaths>);

    const agentRuntime = await create_agent_runtime({
      working_dir: tempRoot,
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime: { emit: vi.fn() },
    });

    await agentRuntime.handle_user_input('hello');

    const tokenStats = await agentRuntime.traceLogger.getTokenStats();
    expect(tokenStats.total_input).toBe(123);
    expect(tokenStats.total_output).toBe(45);
    expect(tokenStats.total_cache_creation).toBe(67);
    expect(tokenStats.total_cache_read).toBe(8);
  });

  it('converts unexpected turn-router errors into runtime error events instead of throwing', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    setup_common_mocks(session, provider);

    const events: RuntimeEvent[] = [];
    const runtime: RuntimeSink = {
      emit: (event) => {
        events.push(event);
      },
    };

    const agentRuntime = await create_agent_runtime({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime,
      slash_handler: () => {
        throw new Error('slash exploded');
      },
    });

    await expect(agentRuntime.handle_user_input('hello')).resolves.toBeUndefined();

    expect(events.some((event) => event.type === 'error' && event.message === 'Turn Error: slash exploded')).toBe(true);
    expect(events.some((event) => event.type === 'turn_completed' && event.content === 'Error: slash exploded')).toBe(true);
    expect(session.messages.some((m) => m.role === 'assistant' && m.content === 'Error: slash exploded')).toBe(true);
  });

  it('rebuilds LLM context after compaction before streaming', async () => {
    const summaryMessage: Message = { role: 'system', content: '【历史摘要】压缩后的摘要' };
    const oldMessages = Array.from({ length: 23 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `message-${index}`,
    }));
    const session = create_mock_session();
    session.messages.push(...oldMessages);
    session.compact = vi.fn(async () => {
      session.messages.splice(0, session.messages.length, summaryMessage, { role: 'user', content: 'latest question' });
    });

    const provider = create_mock_provider();
    mock_llm_responses = [{ content: 'Hello!', finish_reason: 'stop' }];
    setup_common_mocks(session, provider);

    const agentRuntime = await create_agent_runtime({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime: { emit: vi.fn() },
    });

    await agentRuntime.handle_user_input('latest question');

    expect(session.compact).toHaveBeenCalled();
    expect(provider.chat_stream).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringContaining('【历史摘要】压缩后的摘要') }),
      ]),
      expect.anything(),
    );
    const streamedMessages = (provider.chat_stream as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? [];
    expect(streamedMessages.some((message) => message.content === 'message-0')).toBe(false);
  });

  it('exposes dynamic skill slash commands and load summary', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    setup_common_mocks(session, provider);

    vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({
      load: vi.fn(async () => {}),
      list_drafts: vi.fn(() => [
        {
          id: 'draft-fix',
          name: 'Draft Fix',
          task_type: 'fix-bug',
        },
      ]),
      approve_draft: vi.fn(async () => null),
      reject_draft: vi.fn(async () => false),
      getAll: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          trigger_condition: 'LLM concept guidance',
          trigger_pattern: '(解释|讲解).*(LLM|Transformer)',
          steps: [],
          pitfalls: [],
          task_type: 'docs',
          created_at: 0,
          updated_at: 0,
          call_count: 0,
          success_count: 0,
        },
      ]),
      getManifest: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          description: 'LLM concept guidance',
          triggers: ['LLM concept guidance'],
          trigger_pattern: '(解释|讲解).*(LLM|Transformer)',
          task_type: 'docs',
          scope: 'builtin',
          enabled: true,
          priority: 80,
          version: 1,
          updated_at: new Date().toISOString(),
          source_path: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
        },
        {
          id: 'draft-fix',
          name: 'Draft Fix',
          description: 'draft',
          triggers: ['draft'],
          task_type: 'fix-bug',
          scope: 'learning_draft',
          enabled: false,
          priority: 10,
          version: 1,
          updated_at: new Date().toISOString(),
          source_path: '.chromatopsia/skills/drafts/draft-fix.md',
        },
      ]),
    } as unknown as skillStoreModule.SkillStore);

    const agentRuntime = await create_agent_runtime({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime: { emit: vi.fn() },
    });

    expect(agentRuntime.list_slash_commands()).toEqual([
      { input: '/llm-concept-explainer', description: 'Load skill guidance: LLM Concept Explainer' },
    ]);
    expect(agentRuntime.list_draft_skills()).toEqual([
      { id: 'draft-fix', name: 'Draft Fix', task_type: 'fix-bug' },
    ]);
    expect(agentRuntime.get_skill_load_message()).toContain('Loaded 2 skills');
  });

  it('lets the model load Skill guidance and then continue with ordinary tools', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-skill-tool-test-'));
    fs.writeFileSync(path.join(tempRoot, 'note.txt'), 'ordinary tool output', 'utf-8');

    const session = create_mock_session();
    const provider = create_mock_provider();
    mock_llm_responses = [
      {
        content: '',
        finish_reason: 'tool_use',
        tool_calls: [
          { id: 'tc-skill', name: 'Skill', arguments: { name: 'LLM Concept Explainer', args: 'explain RMSNorm' } },
        ],
      },
      {
        content: '',
        finish_reason: 'tool_use',
        tool_calls: [
          { id: 'tc-read', name: 'Read', arguments: { file_path: 'note.txt' } },
        ],
      },
      { content: 'Used the loaded guidance and read the file.', finish_reason: 'stop' },
    ];
    setup_common_mocks(session, provider);

    vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({
      load: vi.fn(async () => {}),
      list_drafts: vi.fn(() => []),
      approve_draft: vi.fn(async () => null),
      reject_draft: vi.fn(async () => false),
      getAll: vi.fn(() => []),
      getManifest: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          description: 'LLM concept guidance',
          userInvocable: true,
          context: 'inline',
          triggers: ['LLM concept guidance'],
          task_type: 'docs',
          scope: 'builtin',
          enabled: true,
          priority: 80,
          version: 1,
          updated_at: new Date().toISOString(),
          sourcePath: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
          source_path: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
        },
      ]),
      loadDocument: vi.fn(async () => ({
        manifest: {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          description: 'LLM concept guidance',
          userInvocable: true,
          context: 'inline',
          triggers: ['LLM concept guidance'],
          task_type: 'docs',
          scope: 'builtin',
          enabled: true,
          priority: 80,
          version: 1,
          updated_at: new Date().toISOString(),
          sourcePath: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
          source_path: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
        },
        body: '# LLM Concept Explainer\n\n## Procedure\nExplain the concept using the six-section structure.',
        raw: '',
      })),
    } as unknown as skillStoreModule.SkillStore);

    const events: RuntimeEvent[] = [];
    const agentRuntime = await create_agent_runtime({
      working_dir: tempRoot,
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime: { emit: (event) => events.push(event) },
    });

    await agentRuntime.handle_user_input('explain RMSNorm using the concept skill');

    const toolFinished = events.filter((event) => event.type === 'tool_finished');
    expect(toolFinished.some((event) => event.type === 'tool_finished' && event.toolCall.name === 'Skill' && event.result.output.includes('Explain the concept using the six-section structure.'))).toBe(true);
    expect(toolFinished.some((event) => event.type === 'tool_finished' && event.toolCall.name === 'Read' && event.result.output.includes('ordinary tool output'))).toBe(true);
    expect(provider.chat_stream).toHaveBeenCalledTimes(3);
  });

  it('preloads an auto-registered slash alias as guidance for a normal turn', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    mock_llm_responses = [{ content: 'I used the preloaded guidance.', finish_reason: 'stop' }];
    setup_common_mocks(session, provider);

    const loadDocument = vi.fn(async () => ({
      manifest: {
        id: 'llm-concept-explainer',
        name: 'LLM Concept Explainer',
        description: 'LLM concept guidance',
        userInvocable: true,
        context: 'inline' as const,
        triggers: ['LLM concept guidance'],
        task_type: 'docs',
        scope: 'builtin' as const,
        enabled: true,
        priority: 80,
        version: 1,
        updated_at: new Date().toISOString(),
        sourcePath: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
        source_path: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
      },
      body: '# LLM Concept Explainer\n\n## Procedure\nExplain the concept using the six-section structure.',
      raw: '',
    }));

    vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({
      load: vi.fn(async () => {}),
      list_drafts: vi.fn(() => []),
      approve_draft: vi.fn(async () => null),
      reject_draft: vi.fn(async () => false),
      getAll: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          trigger_condition: 'LLM concept guidance',
          steps: [],
          pitfalls: [],
          task_type: 'docs',
          created_at: 0,
          updated_at: 0,
          call_count: 0,
          success_count: 0,
        },
      ]),
      getManifest: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          description: 'LLM concept guidance',
          triggers: ['LLM concept guidance'],
          task_type: 'docs',
          scope: 'builtin',
          enabled: true,
          priority: 80,
          version: 1,
          updated_at: new Date().toISOString(),
          source_path: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
        },
      ]),
      loadDocument,
    } as unknown as skillStoreModule.SkillStore);

    const agentRuntime = await create_agent_runtime({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime: { emit: vi.fn() },
    });

    await agentRuntime.handle_user_input('/llm-concept-explainer RMSNorm');

    expect(loadDocument).toHaveBeenCalledWith('llm-concept-explainer');
    expect(provider.chat_stream).toHaveBeenCalledTimes(1);
    const messages = (provider.chat_stream as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? [];
    expect(messages.some((message: Message) => message.role === 'system' && message.content.includes('Skill "LLM Concept Explainer" loaded.'))).toBe(true);
    expect(messages.some((message: Message) => message.role === 'system' && message.content.includes('User intent/context: RMSNorm'))).toBe(true);
    expect(messages.some((message: Message) => message.role === 'system' && message.content.includes('Explain the concept using the six-section structure.'))).toBe(true);
  });

  it('reports an error when slash skill guidance cannot be loaded', async () => {
    const session = create_mock_session();
    const provider = create_mock_provider();
    setup_common_mocks(session, provider);

    vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({
      load: vi.fn(async () => {}),
      list_drafts: vi.fn(() => []),
      approve_draft: vi.fn(async () => null),
      reject_draft: vi.fn(async () => false),
      getAll: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          trigger_condition: 'LLM concept guidance',
          steps: [],
          pitfalls: [],
          task_type: 'docs',
          created_at: 0,
          updated_at: 0,
          call_count: 0,
          success_count: 0,
        },
      ]),
      getManifest: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          description: 'LLM concept guidance',
          triggers: ['LLM concept guidance'],
          task_type: 'docs',
          scope: 'builtin',
          enabled: true,
          priority: 80,
          version: 1,
          updated_at: new Date().toISOString(),
          source_path: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
        },
      ]),
      loadDocument: vi.fn(async () => null),
    } as unknown as skillStoreModule.SkillStore);

    const events: RuntimeEvent[] = [];
    const agentRuntime = await create_agent_runtime({
      working_dir: '/tmp',
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime: { emit: (event) => events.push(event) },
    });

    await agentRuntime.handle_user_input('/llm-concept-explainer');

    expect(provider.chat_stream).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'error' && event.message.includes('skill guidance not found'))).toBe(true);
    expect(events.some((event) => event.type === 'turn_completed' && event.content.includes('skill guidance not found'))).toBe(true);
  });

  it('lets slash-loaded skill guidance continue with ordinary tools', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-slash-skill-test-'));
    fs.writeFileSync(path.join(tempRoot, 'note.txt'), 'slash ordinary tool output', 'utf-8');

    const session = create_mock_session();
    const provider = create_mock_provider();
    mock_llm_responses = [
      {
        content: '',
        finish_reason: 'tool_use',
        tool_calls: [
          { id: 'tc-read', name: 'Read', arguments: { file_path: 'note.txt' } },
        ],
      },
      { content: 'Used slash-loaded guidance and read the file.', finish_reason: 'stop' },
    ];
    setup_common_mocks(session, provider);

    vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({
      load: vi.fn(async () => {}),
      list_drafts: vi.fn(() => []),
      approve_draft: vi.fn(async () => null),
      reject_draft: vi.fn(async () => false),
      getAll: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          trigger_condition: 'LLM concept guidance',
          steps: [],
          pitfalls: [],
          task_type: 'docs',
          created_at: 0,
          updated_at: 0,
          call_count: 0,
          success_count: 0,
        },
      ]),
      getManifest: vi.fn(() => [
        {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          description: 'LLM concept guidance',
          triggers: ['LLM concept guidance'],
          task_type: 'docs',
          scope: 'builtin',
          enabled: true,
          priority: 80,
          version: 1,
          updated_at: new Date().toISOString(),
          source_path: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
        },
      ]),
      loadDocument: vi.fn(async () => ({
        manifest: {
          id: 'llm-concept-explainer',
          name: 'LLM Concept Explainer',
          description: 'LLM concept guidance',
          userInvocable: true,
          context: 'inline',
          triggers: ['LLM concept guidance'],
          task_type: 'docs',
          scope: 'builtin',
          enabled: true,
          priority: 80,
          version: 1,
          updated_at: new Date().toISOString(),
          source_path: 'packages/agent/skills/builtin/llm-concept-explainer/SKILL.md',
        },
        body: '# LLM Concept Explainer\n\n## Procedure\nUse ordinary tools after reading this guidance.',
        raw: '',
      })),
    } as unknown as skillStoreModule.SkillStore);

    const events: RuntimeEvent[] = [];
    const agentRuntime = await create_agent_runtime({
      working_dir: tempRoot,
      provider: 'anthropic',
      config: { api_key: 'test' },
      runtime: { emit: (event) => events.push(event) },
    });

    await agentRuntime.handle_user_input('/llm-concept-explainer RMSNorm note');

    const toolFinished = events.filter((event) => event.type === 'tool_finished');
    expect(toolFinished.some((event) => event.type === 'tool_finished' && event.toolCall.name === 'Read' && event.result.output.includes('slash ordinary tool output'))).toBe(true);
    expect(provider.chat_stream).toHaveBeenCalledTimes(2);
  });
});
