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

const skillMarkdown = `---
id: git-status-review
name: Git Status Review
description: Use when the user asks to inspect git status and summarize repository risk.
user-invocable: true
context: inline
triggers:
  - inspect git status
task_type: git
scope: learning_draft
enabled: false
priority: 10
version: 1
updated_at: 2026-04-23T00:00:00.000Z
---

# Git Status Review

## When To Use
Use this when git status and repository risk need to be summarized.

## Procedure
Inspect status and diffs, then explain risks before suggesting changes.

## Pitfalls
Do not discard user work.

## Verification
Confirm the answer references the observed status.`;

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
      tool_call_count: 5,
      used_skill_ids: ['git-skill'],
      matched_skill_ids: ['git-skill'],
      skill_loads: ['git-skill'],
      error_count: 0,
      final_outcome: 'success',
      task_complexity_signal: 'complex',
      skill_feedback: 'helpful',
    });

    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      task_type: 'git',
      user_input: 'check repo',
      tool_calls: [toolCall],
      tool_results: [toolResult],
      tool_call_count: 5,
      used_skill_ids: ['git-skill'],
      matched_skill_ids: ['git-skill'],
      skill_loads: ['git-skill'],
      error_count: 0,
      final_outcome: 'success',
      task_complexity_signal: 'complex',
      skill_feedback: 'helpful',
    }));
  });

  it('only considers recent batch tool activity before running synthesis', async () => {
    const provider = createProvider('{"should_learn":false,"confidence":0.9,"reasoning":"not enough recent tool activity"}');
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

  it('saves synthesized SKILL.md draft documents', async () => {
    const provider = createProvider(JSON.stringify({
      decision: 'create',
      confidence: 0.9,
      reasoning: 'reusable workflow',
      target_skill_id: null,
      evidence: ['two successful tool-backed turns'],
      risk_notes: [],
      skill_markdown: skillMarkdown,
    }));
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
      skillRegistry: { match: vi.fn(() => null), fuzzy_match: vi.fn(() => []), getById: vi.fn() } as never,
      eventStore: eventStore as never,
    }, 2, 0.75);

    const result = await worker.onTurnCompleted('git', 'check repo');

    expect(result).toEqual({ triggered: true, draftName: 'Git Status Review' });
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      manifest: expect.objectContaining({
        id: 'git-status-review',
        scope: 'learning_draft',
        enabled: false,
        draft_kind: 'create',
      }),
      body: expect.stringContaining('## Procedure'),
    }));
    expect(eventStore.resetSessionTurns).toHaveBeenCalledWith('session-1');
  });

  it('does not save create drafts below min confidence', async () => {
    const provider = createProvider(JSON.stringify({
      decision: 'create',
      confidence: 0.5,
      reasoning: 'weak signal',
      target_skill_id: null,
      evidence: [],
      risk_notes: [],
      skill_markdown: skillMarkdown,
    }));
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
      skillRegistry: { match: vi.fn(() => null), fuzzy_match: vi.fn(() => []), getById: vi.fn() } as never,
      eventStore: eventStore as never,
    }, 2, 0.75);

    const result = await worker.onTurnCompleted('git', 'check repo');

    expect(result.triggered).toBe(false);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(eventStore.resetSessionTurns).not.toHaveBeenCalled();
  });

  it('saves patch drafts for existing active skills', async () => {
    const provider = createProvider(JSON.stringify({
      decision: 'patch',
      confidence: 0.9,
      reasoning: 'existing skill missed verification',
      target_skill_id: 'existing-git-skill',
      patch_plan: 'Add verification guidance.',
      evidence: ['failed verification was recovered manually'],
      risk_notes: [],
      skill_markdown: skillMarkdown,
    }));
    const savePatchDraft = vi.fn(async () => {});
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
      skillStore: { save_draft: vi.fn(), save_patch_draft: savePatchDraft } as never,
      skillRegistry: {
        match: vi.fn(() => null),
        fuzzy_match: vi.fn(() => []),
        getById: vi.fn(() => ({ id: 'existing-git-skill' })),
      } as never,
      eventStore: eventStore as never,
    }, 2, 0.75);

    const result = await worker.onTurnCompleted('git', 'check repo');

    expect(result).toEqual({ triggered: true, draftName: 'Git Status Review' });
    expect(savePatchDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: expect.objectContaining({
          draft_kind: 'patch',
          target_skill_id: 'existing-git-skill',
          patch_plan: 'Add verification guidance.',
        }),
      }),
      'existing-git-skill',
      'Add verification guidance.',
    );
    expect(eventStore.resetSessionTurns).toHaveBeenCalledWith('session-1');
  });

  it('does not reset turn counter when synthesis does not produce an approved draft', async () => {
    const provider = createProvider('{"decision":"skip","confidence":0.4,"reasoning":"not reusable"}');
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
      skillRegistry: { match: vi.fn(() => null), fuzzy_match: vi.fn(() => []), getById: vi.fn() } as never,
      eventStore: eventStore as never,
    }, 2, 0.75);

    const result = await worker.onTurnCompleted('git', 'check repo');

    expect(result.triggered).toBe(false);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(eventStore.resetSessionTurns).not.toHaveBeenCalled();
  });
});
