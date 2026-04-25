import type { LLMProvider, Message, Session, ToolCall, ToolResult } from '../foundation/types.js';
import type { LearningWorker } from '../learning/worker.js';
import { buildMemoryInjection } from '../memory/injector.js';
import type { MemoryIndexStore } from '../memory/index-store.js';
import type { MemoryTopicStore } from '../memory/topic-store.js';
import { maybeWriteMemory } from '../memory/writer.js';
import type { SkillStore } from '../skills/store.js';
import type { RuntimeEventInput } from './runtime.js';

export interface LearningTurnPayload {
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

export async function loadMemorySystemMessages(
  input: string,
  memoryIndexStore: MemoryIndexStore,
  memoryTopicStore: MemoryTopicStore,
): Promise<Message[]> {
  try {
    const memoryInjection = await buildMemoryInjection(input, memoryIndexStore, memoryTopicStore);
    return memoryInjection.systemMessages;
  } catch {
    return [];
  }
}

export async function persistTurnMemory(
  input: string,
  session: Session,
  provider: LLMProvider,
  memoryIndexStore: MemoryIndexStore,
  memoryTopicStore: MemoryTopicStore,
): Promise<void> {
  try {
    await maybeWriteMemory(input, session, provider, memoryIndexStore, memoryTopicStore);
  } catch {
    // best-effort memory write
  }
}

export interface LearningTurnHookOptions {
  learningWorker: LearningWorker | null;
  skillStore: SkillStore;
  reminderEnabled: boolean;
  reminderMaxPerSession: number;
  emitRuntime: (event: RuntimeEventInput) => void;
}

export function createLearningTurnHook(
  options: LearningTurnHookOptions,
): (
  taskType: string,
  userInput: string,
  payload?: LearningTurnPayload,
) => Promise<void> {
  const {
    learningWorker,
    skillStore,
    reminderEnabled,
    reminderMaxPerSession,
    emitRuntime,
  } = options;
  let reminderShown = 0;

  return async (
    taskType: string,
    userInput: string,
    payload?: LearningTurnPayload,
  ): Promise<void> => {
    if (!learningWorker) return;

    const result = await learningWorker.onTurnCompleted(taskType, userInput, payload);
    if (result.triggered && result.draftName) {
      emitRuntime({ type: 'notification', message: `Draft skill generated: ${result.draftName}` });
    }
    if (!reminderEnabled || reminderShown >= reminderMaxPerSession) return;

    const drafts = typeof skillStore.list_drafts === 'function' ? skillStore.list_drafts() : [];
    if (drafts.length > 0) {
      reminderShown++;
      emitRuntime({ type: 'notification', message: `[Learning] ${drafts.length} draft(s) pending review` });
    }
  };
}
