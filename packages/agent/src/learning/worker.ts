import type { LLMProvider, Session, Skill, TaskBufferEntry, ToolCall, ToolResult, TurnEvent } from '../foundation/types.js';
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
}

function toTaskBuffer(events: TurnEvent[]): TaskBufferEntry[] {
  return events.map((e) => ({
    tool_calls: normalizeToolCalls(e.tool_calls),
    tool_results: normalizeToolResults(e.tool_results),
    task_type: e.task_type,
    session_id: e.session_id,
    timestamp: e.timestamp,
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

function isValidSkillDraft(skill: Partial<Skill>): skill is Skill {
  return Boolean(
    skill.id &&
      skill.name &&
      skill.trigger_condition &&
      skill.task_type &&
      Array.isArray(skill.steps) &&
      Array.isArray(skill.pitfalls),
  );
}

function normalizeDraft(skill: Skill): Skill {
  const now = Date.now();
  return {
    ...skill,
    created_at: skill.created_at || now,
    updated_at: now,
    call_count: skill.call_count ?? 0,
    success_count: skill.success_count ?? 0,
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

    if (!synthesis.should_learn) {
      return { triggered: false };
    }

    if (!this.passesConfidenceGate(synthesis.confidence)) {
      return { triggered: false };
    }

    if (!synthesis.skill || Object.keys(synthesis.skill).length === 0) {
      return { triggered: false };
    }
    if (!isValidSkillDraft(synthesis.skill)) {
      return { triggered: false };
    }

    const draft = normalizeDraft(synthesis.skill);
    await this.skillStore.save_draft(draft);
    return { triggered: true, draftName: draft.name };
  }

  private passesConfidenceGate(confidence?: number): boolean {
    if (this.minConfidence <= 0) return true;
    if (confidence === undefined) return true;
    if (!Number.isFinite(confidence)) return true;
    return confidence >= this.minConfidence;
  }
}

