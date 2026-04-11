// T-24: tests/repl/loop.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMProvider, LLMResponse, Session, Message } from '../../src/foundation/types.js';
import { run_repl } from '../../src/repl/loop.js';
import * as llmIndex from '../../src/foundation/llm/index.js';
import * as sessionModule from '../../src/agent/session/manager.js';
import * as slashModule from '../../src/repl/slash.js';
import * as executorModule from '../../src/repl/executor.js';
import * as skillRegistryModule from '../../src/skills/registry.js';
import * as skillPatcherModule from '../../src/skills/patcher.js';
import * as skillStoreModule from '../../src/skills/store.js';
import * as hooksApprovalModule from '../../src/hooks/approval.js';

// ---- Mock session factory ----

function create_mock_session(): Session {
  const messages: Message[] = [];
  const session = {
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
  return session;
}

// ---- Mock LLM provider factory ----

let mock_llm_responses: Partial<LLMResponse>[];
let mock_chat_stream_calls: number;

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

// ---- Mock readline interface ----

function create_mock_rl() {
  return {
    question: vi.fn((_prompt: string, cb: (ans: string) => void) => {
      // Don't auto-resolve — tests control when input comes
    }),
    close: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'close') cb();
      return this;
    }),
    prompt: vi.fn(),
  };
}

describe('repl/loop — T-24', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handle_user_input', () => {
    it('should add user message to session', async () => {
      const session = create_mock_session();

      // Mock createProvider to return our mock
      const mock_provider = create_mock_provider();
      mock_llm_responses = [{ content: 'Hello!', finish_reason: 'stop' }];
      vi.spyOn(llmIndex, 'createProvider').mockReturnValue(mock_provider as unknown as ReturnType<typeof llmIndex.createProvider>);

      // Mock SessionManager
      const mock_session_manager = {
        create_session: vi.fn(() => session),
        get_session: vi.fn(() => session),
      };
      vi.spyOn(sessionModule, 'SessionManager').mockReturnValue(mock_session_manager as unknown as sessionModule.SessionManager);

      // Mock SkillRegistry
      const mock_skill_reg = {
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
      };
      vi.spyOn(skillRegistryModule, 'SkillRegistry').mockReturnValue(mock_skill_reg as unknown as skillRegistryModule.SkillRegistry);

      // Mock SkillPatcher
      vi.spyOn(skillPatcherModule, 'SkillPatcher').mockImplementation(() => ({
        patch: vi.fn(),
      } as unknown as skillPatcherModule.SkillPatcher));

      // Mock SkillStore
      const mock_skill_store = {
        load: vi.fn(async () => {}),
        save: vi.fn(async () => {}),
        getAll: vi.fn(() => []),
        getManifest: vi.fn(() => []),
        delete: vi.fn(),
        getAllSkills: vi.fn(() => []),
      };
      vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue(mock_skill_store as unknown as skillStoreModule.SkillStore);

      // Mock ApprovalHook
      vi.spyOn(hooksApprovalModule, 'ApprovalHook').mockImplementation(() => ({
        request_approval: vi.fn(() => null),
        wait_for_decision: vi.fn(async () => ({ request_id: '', decision: 'approve' as const })),
        submit_decision: vi.fn(),
      } as unknown as hooksApprovalModule.ApprovalHook));

      // Mock execute_tool_calls_parallel to return empty
      vi.spyOn(executorModule, 'execute_tool_calls_parallel').mockResolvedValue([]);
      vi.spyOn(executorModule, 'execute_skill').mockResolvedValue([]);

      // Mock handle_slash_command to return false
      vi.spyOn(slashModule, 'handle_slash_command').mockReturnValue(false);

      const mock_rl = create_mock_rl();

      const result = await run_repl({
        working_dir: '/tmp',
        provider: 'anthropic',
        config: { api_key: 'test' },
        readline_interface: mock_rl as unknown as import('node:readline').Interface,
      });

      await result.handle_user_input('hello');

      expect(session.messages.some((m) => m.role === 'user' && m.content === 'hello')).toBe(true);
    });

    it('should add assistant reply to session after LLM response', async () => {
      const session = create_mock_session();

      const mock_provider = create_mock_provider();
      mock_llm_responses = [{ content: 'Hello, how can I help?', finish_reason: 'stop' }];
      vi.spyOn(llmIndex, 'createProvider').mockReturnValue(mock_provider as unknown as ReturnType<typeof llmIndex.createProvider>);

      const mock_session_manager = {
        create_session: vi.fn(() => session),
        get_session: vi.fn(() => session),
      };
      vi.spyOn(sessionModule, 'SessionManager').mockReturnValue(mock_session_manager as unknown as sessionModule.SessionManager);

      const mock_skill_reg = {
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
      };
      vi.spyOn(skillRegistryModule, 'SkillRegistry').mockReturnValue(mock_skill_reg as unknown as skillRegistryModule.SkillRegistry);
      vi.spyOn(skillPatcherModule, 'SkillPatcher').mockImplementation(() => ({ patch: vi.fn() } as unknown as skillPatcherModule.SkillPatcher));
      vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({ load: vi.fn(async () => {}), save: vi.fn(async () => {}), getAll: vi.fn(() => []), getManifest: vi.fn(() => []) } as unknown as skillStoreModule.SkillStore);
      vi.spyOn(hooksApprovalModule, 'ApprovalHook').mockImplementation(() => ({ request_approval: vi.fn(() => null), wait_for_decision: vi.fn(async () => ({ request_id: '', decision: 'approve' as const })), submit_decision: vi.fn() } as unknown as hooksApprovalModule.ApprovalHook));
      vi.spyOn(executorModule, 'execute_tool_calls_parallel').mockResolvedValue([]);
      vi.spyOn(executorModule, 'execute_skill').mockResolvedValue([]);
      vi.spyOn(slashModule, 'handle_slash_command').mockReturnValue(false);

      const mock_rl = create_mock_rl();
      const result = await run_repl({
        working_dir: '/tmp',
        provider: 'anthropic',
        config: { api_key: 'test' },
        readline_interface: mock_rl as unknown as import('node:readline').Interface,
      });

      await result.handle_user_input('hello');

      expect(session.messages.some((m) => m.role === 'assistant')).toBe(true);
    });

    // SKIP: slash commands are now terminal-layer concern, not handled in agent's handle_user_input
    it.skip('should not call LLM for slash commands like /help', async () => {
      const session = create_mock_session();
      const mock_provider = create_mock_provider();
      vi.spyOn(llmIndex, 'createProvider').mockReturnValue(mock_provider as unknown as ReturnType<typeof llmIndex.createProvider>);

      const mock_session_manager = {
        create_session: vi.fn(() => session),
        get_session: vi.fn(() => session),
      };
      vi.spyOn(sessionModule, 'SessionManager').mockReturnValue(mock_session_manager as unknown as sessionModule.SessionManager);

      const mock_skill_reg = {
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
      };
      vi.spyOn(skillRegistryModule, 'SkillRegistry').mockReturnValue(mock_skill_reg as unknown as skillRegistryModule.SkillRegistry);
      vi.spyOn(skillPatcherModule, 'SkillPatcher').mockImplementation(() => ({ patch: vi.fn() } as unknown as skillPatcherModule.SkillPatcher));
      vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({ load: vi.fn(async () => {}), save: vi.fn(async () => {}), getAll: vi.fn(() => []), getManifest: vi.fn(() => []) } as unknown as skillStoreModule.SkillStore);
      vi.spyOn(hooksApprovalModule, 'ApprovalHook').mockImplementation(() => ({ request_approval: vi.fn(() => null), wait_for_decision: vi.fn(async () => ({ request_id: '', decision: 'approve' as const })), submit_decision: vi.fn() } as unknown as hooksApprovalModule.ApprovalHook));
      vi.spyOn(slashModule, 'handle_slash_command').mockReturnValue(true); // slash command handled!
      vi.spyOn(executorModule, 'execute_tool_calls_parallel').mockResolvedValue([]);
      vi.spyOn(executorModule, 'execute_skill').mockResolvedValue([]);

      const mock_rl = create_mock_rl();
      const result = await run_repl({
        working_dir: '/tmp',
        provider: 'anthropic',
        config: { api_key: 'test' },
        readline_interface: mock_rl as unknown as import('node:readline').Interface,
      });

      await result.handle_user_input('/help');

      // LLM should NOT have been called since slash command was handled
      expect(mock_provider.chat_stream).not.toHaveBeenCalled();
    });

    it('should handle LLM response with no tool_calls (plain text)', async () => {
      const session = create_mock_session();
      const mock_provider = create_mock_provider();
      mock_llm_responses = [{ content: 'Here is the information you requested.', finish_reason: 'stop' }];
      vi.spyOn(llmIndex, 'createProvider').mockReturnValue(mock_provider as unknown as ReturnType<typeof llmIndex.createProvider>);

      const mock_session_manager = {
        create_session: vi.fn(() => session),
        get_session: vi.fn(() => session),
      };
      vi.spyOn(sessionModule, 'SessionManager').mockReturnValue(mock_session_manager as unknown as sessionModule.SessionManager);

      const mock_skill_reg = {
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
      };
      vi.spyOn(skillRegistryModule, 'SkillRegistry').mockReturnValue(mock_skill_reg as unknown as skillRegistryModule.SkillRegistry);
      vi.spyOn(skillPatcherModule, 'SkillPatcher').mockImplementation(() => ({ patch: vi.fn() } as unknown as skillPatcherModule.SkillPatcher));
      vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({ load: vi.fn(async () => {}), save: vi.fn(async () => {}), getAll: vi.fn(() => []), getManifest: vi.fn(() => []) } as unknown as skillStoreModule.SkillStore);
      vi.spyOn(hooksApprovalModule, 'ApprovalHook').mockImplementation(() => ({ request_approval: vi.fn(() => null), wait_for_decision: vi.fn(async () => ({ request_id: '', decision: 'approve' as const })), submit_decision: vi.fn() } as unknown as hooksApprovalModule.ApprovalHook));
      vi.spyOn(executorModule, 'execute_tool_calls_parallel').mockResolvedValue([]);
      vi.spyOn(executorModule, 'execute_skill').mockResolvedValue([]);
      vi.spyOn(slashModule, 'handle_slash_command').mockReturnValue(false);

      const mock_rl = create_mock_rl();
      const result = await run_repl({
        working_dir: '/tmp',
        provider: 'anthropic',
        config: { api_key: 'test' },
        readline_interface: mock_rl as unknown as import('node:readline').Interface,
      });

      await result.handle_user_input('tell me about the project');

      expect(session.messages.filter((m) => m.role === 'user').length).toBeGreaterThan(0);
      expect(session.messages.filter((m) => m.role === 'assistant').length).toBeGreaterThan(0);
    });

    it('should execute skill when trigger_match returns a skill', async () => {
      const session = create_mock_session();
      const mock_provider = create_mock_provider();
      vi.spyOn(llmIndex, 'createProvider').mockReturnValue(mock_provider as unknown as ReturnType<typeof llmIndex.createProvider>);

      const mock_session_manager = {
        create_session: vi.fn(() => session),
        get_session: vi.fn(() => session),
      };
      vi.spyOn(sessionModule, 'SessionManager').mockReturnValue(mock_session_manager as unknown as sessionModule.SessionManager);

      const mock_skill = {
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
      };

      const mock_skill_reg = {
        trigger_match: vi.fn(() => mock_skill),
        match: vi.fn(() => null),
        fuzzy_match: vi.fn(() => []),
        register: vi.fn(),
        register_manifest: vi.fn(),
        build_directory_listing: vi.fn(() => ''),
        list: vi.fn(),
        show: vi.fn(),
        delete: vi.fn(),
        search: vi.fn(),
      };
      vi.spyOn(skillRegistryModule, 'SkillRegistry').mockReturnValue(mock_skill_reg as unknown as skillRegistryModule.SkillRegistry);
      vi.spyOn(skillPatcherModule, 'SkillPatcher').mockImplementation(() => ({ patch: vi.fn() } as unknown as skillPatcherModule.SkillPatcher));
      vi.spyOn(skillStoreModule, 'SkillStore').mockReturnValue({ load: vi.fn(async () => {}), save: vi.fn(async () => {}), getAll: vi.fn(() => []), getManifest: vi.fn(() => []) } as unknown as skillStoreModule.SkillStore);
      vi.spyOn(hooksApprovalModule, 'ApprovalHook').mockImplementation(() => ({ request_approval: vi.fn(() => null), wait_for_decision: vi.fn(async () => ({ request_id: '', decision: 'approve' as const })), submit_decision: vi.fn() } as unknown as hooksApprovalModule.ApprovalHook));
      const execute_skill_spy = vi.spyOn(executorModule, 'execute_skill').mockResolvedValue([{ tool_call_id: 'x', output: 'ok', success: true }]);
      vi.spyOn(slashModule, 'handle_slash_command').mockReturnValue(false);

      const mock_rl = create_mock_rl();
      const result = await run_repl({
        working_dir: '/tmp',
        provider: 'anthropic',
        config: { api_key: 'test' },
        readline_interface: mock_rl as unknown as import('node:readline').Interface,
      });

      await result.handle_user_input('test trigger');

      // execute_skill should have been called (not LLM)
      expect(execute_skill_spy).toHaveBeenCalled();
      // LLM should NOT have been called
      expect(mock_provider.chat_stream).not.toHaveBeenCalled();
    });
  });
});
