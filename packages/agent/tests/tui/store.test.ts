import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, RuntimeEvent, ToolCall, ToolResult } from '../../src/foundation/types.js';
import { executeBuiltinCommand, formatBuiltinCommandHelp, matchBuiltinCommand } from '../../tui/src/commands.js';
import { highlightCodeLine, parseMarkdown } from '../../tui/src/components/markdown.js';
import { TuiStore } from '../../tui/src/store.js';
import { getTheme } from '../../tui/src/types.js';

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tool-1',
    name: 'Read',
    arguments: { file_path: '/tmp/file.ts' },
    ...overrides,
  };
}

function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    tool_call_id: 'tool-1',
    output: 'ok',
    success: true,
    ...overrides,
  };
}

function applyEvents(store: TuiStore, events: RuntimeEvent[]) {
  for (const event of events) {
    store.handleRuntimeEvent(event);
  }
}

describe('tui commands', () => {
  it('matches builtin slash commands', () => {
    expect(matchBuiltinCommand('/help')?.command.input).toBe('/help');
    expect(matchBuiltinCommand('/clear')?.command.input).toBe('/clear');
    expect(matchBuiltinCommand('/exit')?.command.input).toBe('/exit');
    expect(matchBuiltinCommand('/theme dark')?.command.input).toBe('/theme dark');
    expect(matchBuiltinCommand('hello')).toBeNull();
  });

  it('formats builtin command help text', () => {
    const help = formatBuiltinCommandHelp();
    expect(help).toContain('/help');
    expect(help).toContain('/clear');
    expect(help).toContain('/exit');
    expect(help).toContain('/theme dark');
  });

  it('executes /clear and calls clear callback', async () => {
    const clearConversation = vi.fn();
    const store = new TuiStore({ clearConversation });
    applyEvents(store, [
      {
        type: 'turn_started',
        turnId: 'turn-1',
        text: 'hello',
        agentId: 'main',
        agentRole: 'main',
        timestamp: Date.now(),
      },
    ]);

    const handled = await executeBuiltinCommand('/clear', store, { clearConversation });

    expect(handled).toBe(true);
    expect(clearConversation).toHaveBeenCalledTimes(1);
    expect(store.getState().transcript).toHaveLength(0);
  });

  it('executes /theme light locally', async () => {
    const store = new TuiStore();

    const handled = await executeBuiltinCommand('/theme light', store);

    expect(handled).toBe(true);
    expect(store.getState().themeMode).toBe('light');
  });
});

describe('TuiStore', () => {
  it('defaults to dark theme mode', () => {
    const store = new TuiStore();

    expect(store.getState().themeMode).toBe('dark');
  });

  it('builds transcript from runtime events', () => {
    const store = new TuiStore();
    const toolCall = createToolCall();
    const toolResult = createToolResult({ output: 'file content', success: true });

    applyEvents(store, [
      {
        type: 'turn_started',
        turnId: 'turn-1',
        text: 'inspect file',
        agentId: 'main',
        agentRole: 'main',
        timestamp: 1,
      },
      {
        type: 'assistant_chunk',
        turnId: 'turn-1',
        chunk: 'Reading ',
        agentId: 'main',
        agentRole: 'main',
        timestamp: 2,
      },
      {
        type: 'assistant_chunk',
        turnId: 'turn-1',
        chunk: 'the file',
        agentId: 'main',
        agentRole: 'main',
        timestamp: 3,
      },
      {
        type: 'tool_started',
        turnId: 'turn-1',
        toolCall,
        agentId: 'main',
        agentRole: 'main',
        timestamp: 4,
      },
      {
        type: 'tool_finished',
        turnId: 'turn-1',
        toolCall,
        result: toolResult,
        agentId: 'main',
        agentRole: 'main',
        timestamp: 5,
      },
      {
        type: 'assistant_message',
        turnId: 'turn-1',
        content: 'Done reading the file.',
        toolCalls: [toolCall],
        agentId: 'main',
        agentRole: 'main',
        timestamp: 6,
      },
      {
        type: 'turn_completed',
        turnId: 'turn-1',
        content: 'Done reading the file.',
        agentId: 'main',
        agentRole: 'main',
        timestamp: 7,
      },
    ]);

    const state = store.getState();
    expect(state.streaming).toBe(false);
    expect(state.currentTurnId).toBeNull();
    expect(state.transcript.map((item) => item.kind)).toEqual(['user', 'assistant', 'tool']);
    const assistant = state.transcript.find((item) => item.kind === 'assistant');
    const tool = state.transcript.find((item) => item.kind === 'tool');
    expect(assistant && assistant.kind === 'assistant' ? assistant.text : '').toBe('Done reading the file.');
    expect(tool && tool.kind === 'tool' ? tool.status : '').toBe('success');
    expect(state.toolActivity['tool-1']?.status).toBe('success');
  });

  it('switches into approval mode and back', () => {
    const store = new TuiStore();
    const request: ApprovalRequest = {
      id: 'approval-1',
      tool_name: 'run_shell',
      args: { command: 'rm -rf .' },
      context: 'tool execution',
      timestamp: 10,
    };

    applyEvents(store, [
      {
        type: 'approval_requested',
        turnId: 'turn-1',
        request,
        agentId: 'main',
        agentRole: 'main',
        timestamp: 10,
      },
    ]);

    expect(store.getState().inputMode).toBe('approval');
    expect(store.getState().approvalRequest?.id).toBe('approval-1');

    const response = store.createApprovalResponse('approve');
    expect(response).toEqual({
      request_id: 'approval-1',
      decision: 'approve',
    });

    applyEvents(store, [
      {
        type: 'approval_resolved',
        turnId: 'turn-1',
        requestId: 'approval-1',
        decision: 'approve',
        agentId: 'main',
        agentRole: 'main',
        timestamp: 11,
      },
    ]);

    expect(store.getState().inputMode).toBe('normal');
    expect(store.getState().approvalRequest).toBeNull();
  });

  it('appends command help through /help', async () => {
    const store = new TuiStore();

    const result = await store.executeInput('/help');

    expect(result.handled).toBe(true);
    expect(store.getState().commandHelpVisible).toBe(true);
    expect(store.getState().transcript.some((item) => item.kind === 'command_help')).toBe(true);
  });

  it('stores dynamically provided slash commands', () => {
    const store = new TuiStore();

    store.setAvailableCommands([
      ...store.getState().availableCommands,
      {
        input: '/llm-concept-explainer',
        description: 'Load skill guidance: LLM Concept Explainer',
        source: 'skill',
      },
    ]);

    expect(store.getState().availableCommands.some((item) => item.input === '/llm-concept-explainer')).toBe(true);
  });

  it('captures notifications and errors', () => {
    const store = new TuiStore();

    applyEvents(store, [
      {
        type: 'notification',
        message: 'Draft skill generated',
        agentId: 'main',
        agentRole: 'main',
        timestamp: 20,
      },
      {
        type: 'error',
        message: 'Something failed',
        agentId: 'main',
        agentRole: 'main',
        timestamp: 21,
      },
    ]);

    expect(store.getState().notifications).toHaveLength(2);
    expect(store.getState().lastError).toBe('Something failed');
  });

  it('parses markdown blocks for headings, lists, and code', () => {
    const blocks = parseMarkdown('# Title\n\n- alpha\n- beta\n\n```ts\nconst value = 1;\n```');

    expect(blocks[0]).toMatchObject({ kind: 'heading', depth: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[2]).toEqual({
      kind: 'code',
      lang: 'ts',
      lines: ['const value = 1;'],
    });
  });

  it('parses emphasis and inline code spans', () => {
    const blocks = parseMarkdown('Hello **bold** and `code` text.');
    const paragraph = blocks[0];

    expect(paragraph).toMatchObject({ kind: 'paragraph' });
    expect(paragraph.kind === 'paragraph' ? paragraph.spans : []).toEqual([
      { kind: 'text', text: 'Hello ' },
      { kind: 'strong', text: 'bold' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ' text.' },
    ]);
  });

  it('tokenizes fenced code lines with syntax colors', () => {
    const segments = highlightCodeLine("const greeting = 'Hello World!';", getTheme('dark'), 'js');

    expect(segments.map((segment) => segment.text).join('')).toBe("const greeting = 'Hello World!';");
    expect(segments.some((segment) => segment.text === 'const' && typeof segment.color === 'string')).toBe(true);
    expect(segments.some((segment) => segment.text.includes("'Hello World!'") && typeof segment.color === 'string')).toBe(true);
  });
});
