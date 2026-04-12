import { describe, it, expect } from 'vitest';
import type {
  Message,
  ToolCall,
  ToolResult,
  ToolDefinition,
  LLMResponse,
  Session,
  Skill,
  ApprovalRequest,
  ApprovalResponse,
  AppConfig,
  CompressionConfig,
  CompressionMetadata,
  SynthesisResult,
  ReplContextValue,
  LLMContext,
  MessageRole,
  DangerLevel,
  TurnEvent,
} from '../src/types.js';

describe('types', () => {
  it('Message should accept valid user message', () => {
    const msg: Message = { role: 'user', content: 'hello' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('Message should accept assistant message with tool_calls', () => {
    const msg: Message = {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'tc1', name: 'Read', arguments: { file_path: 'foo.ts' } }],
    };
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].name).toBe('Read');
  });

  it('Message should accept tool result', () => {
    const msg: Message = {
      role: 'tool',
      tool_results: [{ tool_call_id: 'tc1', output: 'file contents', success: true }],
    };
    expect(msg.tool_results![0].success).toBe(true);
  });

  it('ToolCall should have typed arguments', () => {
    const tc: ToolCall = { id: 'x', name: 'Edit', arguments: { file_path: 'a.ts', old_string: 'foo', new_string: 'bar' } };
    expect(typeof tc.arguments.file_path).toBe('string');
  });

  it('ToolResult should distinguish success from failure', () => {
    const ok: ToolResult = { tool_call_id: 'x', output: 'ok', success: true };
    const fail: ToolResult = { tool_call_id: 'y', output: 'error', success: false };
    expect(ok.success).toBe(true);
    expect(fail.success).toBe(false);
  });

  it('LLMResponse should have stop and tool_use finish_reason', () => {
    const stop: LLMResponse = { content: 'hello', finish_reason: 'stop' };
    const tool: LLMResponse = { content: '', tool_calls: [], finish_reason: 'tool_use' };
    expect(stop.finish_reason).toBe('stop');
    expect(tool.finish_reason).toBe('tool_use');
  });

  it('DangerLevel should be safe | warning | dangerous', () => {
    const levels: DangerLevel[] = ['safe', 'warning', 'dangerous'];
    expect(levels).toContain('safe');
    expect(levels).toContain('warning');
    expect(levels).toContain('dangerous');
  });

  it('MessageRole should be user | assistant | tool | system', () => {
    const roles: MessageRole[] = ['user', 'assistant', 'tool', 'system'];
    expect(roles).toContain('user');
    expect(roles).toContain('system');
  });

  it('Session should have required fields', () => {
    const session: Session = {
      id: 's1',
      messages: [],
      working_directory: '/tmp',
      created_at: Date.now(),
      last_active: Date.now(),
      add_message: () => {},
      clear: () => {},
      compact: () => {},
    };
    expect(session.id).toBe('s1');
    expect(typeof session.add_message).toBe('function');
    expect(typeof session.compact).toBe('function');
  });

  it('Skill should have all lifecycle fields', () => {
    const skill: Skill = {
      id: 'sk1',
      name: 'Git Rebase',
      task_type: 'git-rebase',
      trigger_condition: '整理提交历史',
      steps: ['git rebase -i HEAD~N'],
      pitfalls: ['不要在已推送的提交上执行 rebase'],
      created_at: Date.now(),
      updated_at: Date.now(),
      call_count: 0,
      success_count: 0,
    };
    expect(skill.task_type).toBe('git-rebase');
    expect(skill.pitfalls).toHaveLength(1);
  });

  it('ApprovalRequest should include context for human decision', () => {
    const req: ApprovalRequest = {
      id: 'ar1',
      tool_name: 'run_shell',
      args: { command: 'rm -rf /tmp/test' },
      context: '即将执行删除操作',
      timestamp: Date.now(),
    };
    expect(req.context).toBe('即将执行删除操作');
    expect(req.suggested_approval).toBeUndefined();
  });

  it('ApprovalResponse should support edit decision with modified_args', () => {
    const resp: ApprovalResponse = {
      request_id: 'ar1',
      decision: 'edit',
      modified_args: { command: 'rm -rf /tmp/test2' },
    };
    expect(resp.decision).toBe('edit');
    expect(resp.modified_args?.command).toBe('rm -rf /tmp/test2');
  });

  it('AppConfig should accept both provider types', () => {
    const anthropic: AppConfig = {
      provider: 'anthropic',
      anthropic: { api_key: 'sk-ant-xxx', model: 'claude-opus-4-6' },
    };
    const openai: AppConfig = {
      provider: 'openai',
      openai: { api_key: 'sk-xxx', base_url: 'http://localhost:11434/v1' },
    };
    expect(anthropic.provider).toBe('anthropic');
    expect(openai.provider).toBe('openai');
  });

  it('CompressionConfig should have sane defaults', () => {
    const cfg: CompressionConfig = {
      compress_threshold: 4500,
      preserve_recent: 4,
      min_summarizable: 6,
    };
    expect(cfg.compress_threshold).toBeGreaterThan(cfg.preserve_recent);
  });

  it('CompressionMetadata should distinguish summarize from truncate', () => {
    const summarized: CompressionMetadata = {
      type: 'summarize',
      original_count: 20,
      preserved_count: 6,
      compressed_at: Date.now(),
    };
    const truncated: CompressionMetadata = {
      type: 'truncate',
      original_count: 10,
      preserved_count: 4,
      compressed_at: Date.now(),
    };
    expect(summarized.type).toBe('summarize');
    expect(truncated.type).toBe('truncate');
  });

  it('SynthesisResult should hold partial Skill', () => {
    const result: SynthesisResult = {
      skill: { name: 'New Skill', task_type: 'test' },
      reasoning: 'LLM reasoning here',
    };
    expect(result.skill.name).toBe('New Skill');
    expect(result.reasoning).toBeTruthy();
  });

  it('ToolDefinition danger_level defaults to safe', () => {
    const tool: ToolDefinition = {
      name: 'Read',
      description: 'Read a file',
      input_schema: { type: 'object' },
      handler: async () => ({ tool_call_id: '', output: '', success: true }),
    };
    expect(tool.danger_level).toBeUndefined();
  });

  it('TurnEvent should include session and task metadata', () => {
    const evt: TurnEvent = {
      id: 'evt-1',
      session_id: 's1',
      timestamp: Date.now(),
      task_type: 'refactor',
      user_input: 'refactor parser',
    };
    expect(evt.session_id).toBe('s1');
    expect(evt.task_type).toBe('refactor');
  });
});
