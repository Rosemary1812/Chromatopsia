import type { LLMProvider, Session, SkillDocument, TaskBufferEntry, ToolCall, ToolResult, TurnEvent } from '../foundation/types.js';
import { SkillStore } from '../skills/store.js';
import { SkillRegistry } from '../skills/registry.js';
import { TurnEventStore } from './turn-event-store.js';
import { synthesize_skill } from './synthesis.js';

const DEFAULT_BATCH_TURNS = 20;
const MIN_TOOL_EVENTS = 2;

interface WorkerDeps {
  provider: LLMProvider;
  session: Session;
  skillStore: SkillStore;
  skillRegistry: SkillRegistry;
  eventStore: TurnEventStore;
}

interface CompletedTurnPayload {
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  tool_call_count?: number;
  used_skill_ids?: string[];
  matched_skill_ids?: string[];
  skill_loads?: string[];
  error_count?: number;
  final_outcome?: 'success' | 'failed' | 'unknown';
  task_complexity_signal?: 'simple' | 'complex';
  skill_feedback?: 'helpful' | 'outdated' | 'incomplete' | 'wrong' | 'none';
}

function toTaskBuffer(events: TurnEvent[]): TaskBufferEntry[] {
  return events.map((e) => ({
    tool_calls: normalizeToolCalls(e.tool_calls),
    tool_results: normalizeToolResults(e.tool_results),
    task_type: e.task_type,
    session_id: e.session_id,
    timestamp: e.timestamp,
    tool_call_count: e.tool_call_count,
    used_skill_ids: e.used_skill_ids,
    matched_skill_ids: e.matched_skill_ids,
    skill_loads: e.skill_loads,
    error_count: e.error_count,
    final_outcome: e.final_outcome,
    task_complexity_signal: e.task_complexity_signal,
    skill_feedback: e.skill_feedback,
  }));
}

function normalizeToolCalls(toolCalls: TurnEvent['tool_calls']): ToolCall[] {
  return Array.isArray(toolCalls) ? toolCalls : [];
}

function normalizeToolResults(toolResults: TurnEvent['tool_results']): ToolResult[] {
  return Array.isArray(toolResults) ? toolResults : [];
}

function countToolEvents(buffer: TaskBufferEntry[]): number {
  return buffer.filter((entry) => entry.tool_calls.length > 0 || entry.tool_results.length > 0).length;
}

function isValidSkillDocumentDraft(document: SkillDocument | undefined): document is SkillDocument {
  if (!document) return false;
  const manifest = document.manifest;
  return Boolean(
    manifest.id &&
      manifest.name &&
      manifest.description &&
      manifest.task_type &&
      document.body.trim().length > 0 &&
      /^#\s+/m.test(document.body),
  );
}

function normalizeDraftDocument(
  document: SkillDocument,
  draftKind: 'create' | 'patch',
  patchMetadata?: { targetSkillId?: string; patchPlan?: string },
): SkillDocument {
  return {
    ...document,
    manifest: {
      ...document.manifest,
      userInvocable: document.manifest.userInvocable ?? true,
      context: document.manifest.context ?? 'inline',
      scope: 'learning_draft',
      enabled: false,
      priority: Math.min(document.manifest.priority, 10),
      updated_at: new Date().toISOString(),
      draft_kind: draftKind,
      target_skill_id: patchMetadata?.targetSkillId,
      patch_plan: patchMetadata?.patchPlan,
    },
  };
}

export class LearningWorker {
  private provider: LLMProvider;
  private session: Session;
  private skillStore: SkillStore;
  private skillRegistry: SkillRegistry;
  private eventStore: TurnEventStore;
  private batchTurns: number;
  private minConfidence: number;
  private runningSessions = new Set<string>();

  constructor(
    deps: WorkerDeps,
    batchTurns: number = DEFAULT_BATCH_TURNS,
    minConfidence: number = 0.75,
  ) {
    this.provider = deps.provider;
    this.session = deps.session;
    this.skillStore = deps.skillStore;
    this.skillRegistry = deps.skillRegistry;
    this.eventStore = deps.eventStore;
    this.batchTurns = batchTurns;
    this.minConfidence = minConfidence;
  }

  async onTurnCompleted(
    taskType: string,
    userInput: string,
    payload: CompletedTurnPayload = {},
  ): Promise<{ triggered: boolean; draftName?: string }> {
    const event: TurnEvent = {
      id: `evt-${this.session.id}-${Date.now().toString(36)}`,
      session_id: this.session.id,
      timestamp: Date.now(),
      task_type: taskType,
      user_input: userInput,
      tool_calls: normalizeToolCalls(payload.tool_calls),
      tool_results: normalizeToolResults(payload.tool_results),
      tool_call_count: payload.tool_call_count ?? normalizeToolCalls(payload.tool_calls).length,
      used_skill_ids: payload.used_skill_ids ?? [],
      matched_skill_ids: payload.matched_skill_ids ?? [],
      skill_loads: payload.skill_loads ?? payload.used_skill_ids ?? [],
      error_count: payload.error_count ?? normalizeToolResults(payload.tool_results).filter((result) => !result.success).length,
      final_outcome: payload.final_outcome ?? 'unknown',
      task_complexity_signal: payload.task_complexity_signal ?? ((payload.tool_call_count ?? normalizeToolCalls(payload.tool_calls).length) >= 5 ? 'complex' : 'simple'),
      skill_feedback: payload.skill_feedback ?? 'none',
    };
    await this.eventStore.append(event);

    const turns = await this.eventStore.incrementSessionTurns(this.session.id);
    if (turns < this.batchTurns) {
      return { triggered: false };
    }
    if (this.runningSessions.has(this.session.id)) {
      return { triggered: false };
    }

    this.runningSessions.add(this.session.id);
    try {
      const result = await this.runLearningJob();
      if (result.triggered) {
        await this.eventStore.resetSessionTurns(this.session.id);
      }
      return result;
    } finally {
      this.runningSessions.delete(this.session.id);
    }
  }

  private async runLearningJob(): Promise<{ triggered: boolean; draftName?: string }> {
    const recentEvents = await this.eventStore.recentBySession(this.session.id, this.batchTurns);
    if (recentEvents.length < this.batchTurns) {
      return { triggered: false };
    }

    const buffer = toTaskBuffer(recentEvents);
    const toolEvents = countToolEvents(buffer);
    if (toolEvents < MIN_TOOL_EVENTS) {
      return { triggered: false };
    }

    const lastTaskType = recentEvents[recentEvents.length - 1]?.task_type ?? 'general';
    const synthesis = await synthesize_skill(
      {
        task_buffer: buffer,
        last_task_type: lastTaskType,
      },
      this.provider,
      this.skillRegistry,
    );

    if (!synthesis.should_learn || synthesis.decision === 'skip') {
      return { triggered: false };
    }

    if (!this.passesConfidenceGate(synthesis.confidence)) {
      return { triggered: false };
    }

    if (!isValidSkillDocumentDraft(synthesis.document)) {
      return { triggered: false };
    }

    if (synthesis.decision === 'patch') {
      const targetSkillId = typeof synthesis.target_skill_id === 'string' ? synthesis.target_skill_id : undefined;
      const patchPlan = synthesis.patch_plan;
      if (!targetSkillId || !patchPlan || !this.skillRegistry.getById(targetSkillId)) {
        return { triggered: false };
      }

      const draft = normalizeDraftDocument(synthesis.document, 'patch', {
        targetSkillId,
        patchPlan,
      });
      await this.skillStore.save_patch_draft(draft, targetSkillId, patchPlan);
      return { triggered: true, draftName: draft.manifest.name };
    }

    if (synthesis.decision !== 'create') {
      return { triggered: false };
    }

    const draft = normalizeDraftDocument(synthesis.document, 'create');
    await this.skillStore.save_draft(draft);
    return { triggered: true, draftName: draft.manifest.name };
  }

  private passesConfidenceGate(confidence?: number): boolean {
    if (this.minConfidence <= 0) return true;
    if (confidence === undefined) return false;
    if (!Number.isFinite(confidence)) return false;
    return confidence >= this.minConfidence;
  }
}
