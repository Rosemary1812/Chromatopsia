import { randomUUID } from 'crypto';
import type {
  LLMProvider,
  RuntimeAgentRole,
  RuntimeSink,
  Session,
  Skill,
  SkillDocument,
  SkillManifestEntry,
  ToolContext,
} from '../foundation/types.js';
import type { RuntimeEventInput } from './runtime.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { SkillStore } from '../skills/store.js';
import type { ApprovalHook } from '../hooks/approval.js';
import type { MemoryIndexStore } from '../memory/index-store.js';
import type { MemoryTopicStore } from '../memory/topic-store.js';
import { handle_normal_turn } from './normal-turn.js';
import { loadMemorySystemMessages, persistTurnMemory } from './turn-hooks.js';
import type { LearningTurnPayload } from './turn-hooks.js';

export function build_skill_slash_aliases(skill: Skill): string[] {
  const aliases = new Set<string>([`/${skill.id}`]);
  const slashMatches = skill.trigger_pattern?.match(/\/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [];
  for (const match of slashMatches) {
    aliases.add(match);
  }
  return [...aliases];
}

export function build_skill_load_message(entries: SkillManifestEntry[]): string | null {
  if (entries.length === 0) return null;

  let builtin = 0;
  let user = 0;
  let drafts = 0;

  for (const entry of entries) {
    if (entry.scope === 'builtin') builtin++;
    if (entry.scope === 'user' || entry.scope === 'project') user++;
    if (entry.scope === 'learning_draft') drafts++;
  }

  const enabled = entries.filter((entry) => entry.scope !== 'learning_draft' && entry.enabled !== false);
  return `Loaded ${entries.length} skills (${builtin} builtin, ${user} user, ${drafts} draft; ${enabled.length} active).`;
}

export function buildLoadedSkillSystemMessage(
  document: SkillDocument,
  userIntent?: string,
): string {
  const lines = [`Skill "${document.manifest.name}" loaded.`, ''];
  const intent = userIntent?.trim();
  if (intent) {
    lines.push(`User intent/context: ${intent}`, '');
  }
  lines.push('<skill markdown body>', document.body.trim(), '</skill markdown body>');
  return lines.join('\n');
}

export function infer_task_type(input: string): string {
  const q = input.toLowerCase().trim();
  if (q.startsWith('fix') || q.includes('bug')) return 'fix-bug';
  if (q.startsWith('test')) return 'testing';
  if (q.startsWith('refactor') || q.includes('重构')) return 'refactor';
  if (q.startsWith('add') || q.includes('新增') || q.includes('实现')) return 'add-feature';
  if (q.includes('git')) return 'git';
  if (q.includes('deploy') || q.includes('发布')) return 'deploy';
  if (q.includes('docs') || q.includes('文档')) return 'docs';
  return 'general';
}

export function buildRuntimeSkillCommands(
  skillStore: SkillStore,
): Array<{ input: string; description: string }> {
  const manifestById = new Map(skillStore.getManifest().map((entry) => [entry.id, entry]));
  const commands = new Map<string, { input: string; description: string }>();

  for (const skill of skillStore.getAll()) {
    const manifest = manifestById.get(skill.id);
    if (!manifest || manifest.scope === 'learning_draft' || manifest.enabled === false) {
      continue;
    }
    for (const alias of build_skill_slash_aliases(skill)) {
      const key = alias.toLowerCase();
      if (!commands.has(key)) {
        commands.set(key, {
          input: alias,
          description: `Load skill guidance: ${skill.name}`,
        });
      }
    }
  }

  return [...commands.values()].sort((left, right) => left.input.localeCompare(right.input));
}

export function resolveSkillFromSlashInput(
  input: string,
  skillStore: SkillStore,
): Skill | null {
  const firstToken = input.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!firstToken?.startsWith('/')) return null;

  const skillsById = new Map(skillStore.getAll().map((skill) => [skill.id, skill]));
  for (const entry of skillStore.getManifest()) {
    if (entry.scope === 'learning_draft' || entry.enabled === false) continue;
    const skill = skillsById.get(entry.id);
    if (!skill) continue;

    for (const alias of build_skill_slash_aliases(skill)) {
      if (alias.toLowerCase() === firstToken) {
        return skill;
      }
    }
  }

  return null;
}

export function listRuntimeDrafts(
  skillStore: SkillStore,
): Array<{ id: string; name: string; task_type: string }> {
  return skillStore.list_drafts().map((skill) => ({
    id: skill.id,
    name: skill.name,
    task_type: skill.task_type,
  }));
}

export interface LearningCommandHandlerOptions {
  skillStore: SkillStore;
  skillRegistry: SkillRegistry;
  emitRuntime: (event: RuntimeEventInput) => void;
}

export function createLearningCommandHandler(
  options: LearningCommandHandlerOptions,
): (input: string, turnId: string) => Promise<boolean> {
  const {
    skillStore,
    skillRegistry,
    emitRuntime,
  } = options;

  return async (input: string, turnId: string): Promise<boolean> => {
    if (!input.startsWith('/skill')) return false;
    const parts = input.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return false;
    const sub = parts[1];

    if (sub === 'review') {
      const drafts = skillStore.list_drafts();
      if (parts.length >= 3) {
        const id = parts[2];
        const document = await skillStore.loadDocument(id);
        if (!document || document.manifest.scope !== 'learning_draft') {
          emitRuntime({ type: 'turn_completed', turnId, content: `Draft "${id}" not found.` });
          return true;
        }

        const full = parts[3] === 'full' || parts[3] === '--full';
        if (full) {
          emitRuntime({ type: 'turn_completed', turnId, content: document.raw || buildLoadedSkillSystemMessage(document) });
          return true;
        }

        const lines = [
          `Draft skill: ${document.manifest.name}`,
          `kind: ${document.manifest.draft_kind ?? 'create'}`,
          `id: ${document.manifest.id}`,
          ...(document.manifest.target_skill_id ? [`target_skill_id: ${document.manifest.target_skill_id}`] : []),
          ...(document.manifest.patch_plan ? [`patch_plan: ${document.manifest.patch_plan}`] : []),
          `description: ${document.manifest.description || '(none)'}`,
          `task_type: ${document.manifest.task_type}`,
          `triggers: ${document.manifest.triggers.join(', ') || '(none)'}`,
          '',
          document.body.trim().slice(0, 1200),
          '',
          `Use /skill review ${document.manifest.id} full to view the full SKILL.md.`,
        ];
        emitRuntime({ type: 'turn_completed', turnId, content: lines.join('\n') });
        return true;
      }

      if (drafts.length === 0) {
        emitRuntime({ type: 'turn_completed', turnId, content: 'No draft skills pending review.' });
      } else {
        const lines = await Promise.all(drafts.map(async (d) => {
          const document = await skillStore.loadDocument(d.id);
          const kind = document?.manifest.draft_kind ?? 'create';
          const target = document?.manifest.target_skill_id ? ` -> ${document.manifest.target_skill_id}` : '';
          return `- ${d.id}: ${d.name} [${d.task_type}; ${kind}${target}]`;
        }));
        emitRuntime({ type: 'turn_completed', turnId, content: ['Draft skills pending review:', ...lines].join('\n') });
      }
      return true;
    }

    if ((sub === 'approve' || sub === 'reject') && parts.length >= 3) {
      const id = parts[2];
      if (sub === 'approve') {
        const approved = await skillStore.approve_draft(id);
        if (!approved) {
          emitRuntime({ type: 'turn_completed', turnId, content: `Draft "${id}" not found.` });
          return true;
        }
        const approvedDocument = await skillStore.loadDocument(approved.id);
        if (approvedDocument) {
          skillRegistry.register_manifest(approvedDocument.manifest);
        } else {
          skillRegistry.register_manifest({
            id: approved.id,
            name: approved.name,
            description: approved.trigger_condition,
            triggers: [approved.trigger_condition],
            trigger_pattern: approved.trigger_pattern,
            task_type: approved.task_type,
            scope: 'user',
            enabled: true,
            priority: 50,
            version: 1,
            updated_at: new Date(approved.updated_at).toISOString(),
            source_path: `.chromatopsia/skills/user/${approved.id}/SKILL.md`,
          });
        }
        skillRegistry.register(approved);
        const aliases = build_skill_slash_aliases(approved).join(', ');
        emitRuntime({ type: 'notification', message: `Skill loaded: ${approved.name}${aliases ? ` (${aliases})` : ''}` });
        emitRuntime({ type: 'turn_completed', turnId, content: `Draft approved and published: ${approved.name}` });
        return true;
      }

      const rejected = await skillStore.reject_draft(id);
      emitRuntime({ type: 'turn_completed', turnId, content: rejected ? `Draft rejected: ${id}` : `Draft "${id}" not found.` });
      return true;
    }

    return false;
  };
}

export interface TurnRouterDependencies {
  session: Session;
  provider: LLMProvider;
  skillRegistry: SkillRegistry;
  skillStore: SkillStore;
  approvalHook: ApprovalHook;
  toolContext: ToolContext;
  isDebug: boolean;
  runtime: RuntimeSink;
  runtimeMetadata: { agentId: string; agentRole?: RuntimeAgentRole };
  emitRuntime: (event: RuntimeEventInput) => void;
  slashHandler: (input: string, session: Session, skill_reg: SkillRegistry) => boolean;
  handleLearningCommand: (input: string, turnId: string) => Promise<boolean>;
  memoryIndexStore: MemoryIndexStore;
  memoryTopicStore: MemoryTopicStore;
  triggerLearningAfterTurn: (
    taskType: string,
    userInput: string,
    payload?: LearningTurnPayload,
  ) => Promise<void>;
}

function buildLearningPayload(
  summary: Awaited<ReturnType<typeof handle_normal_turn>>,
  skillSignals: Pick<LearningTurnPayload, 'matched_skill_ids' | 'used_skill_ids'> = {},
): LearningTurnPayload {
  const usedSkillIds = new Set(summary.usedSkillIds);
  for (const id of skillSignals.used_skill_ids ?? []) usedSkillIds.add(id);

  return {
    tool_calls: summary.toolCalls,
    tool_results: summary.toolResults,
    tool_call_count: summary.toolCallCount,
    used_skill_ids: [...usedSkillIds],
    matched_skill_ids: skillSignals.matched_skill_ids ?? [],
    skill_loads: [...new Set([...summary.skillLoads, ...usedSkillIds])],
    error_count: summary.errorCount,
    final_outcome: summary.finalOutcome,
    task_complexity_signal: summary.taskComplexitySignal,
    skill_feedback: 'none',
  };
}

export function createHandleUserInputTurn(
  deps: TurnRouterDependencies,
): (input: string) => Promise<void> {
  const {
    session,
    provider,
    skillRegistry,
    skillStore,
    approvalHook,
    toolContext,
    isDebug,
    runtime,
    runtimeMetadata,
    emitRuntime,
    slashHandler,
    handleLearningCommand,
    memoryIndexStore,
    memoryTopicStore,
    triggerLearningAfterTurn,
  } = deps;

  return async (input: string): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const turnId = randomUUID();

    emitRuntime({ type: 'turn_started', turnId, text: trimmed });

    try {
      session.add_message({ role: 'user', content: trimmed });
      let turnTaskType = infer_task_type(trimmed);

      if (await handleLearningCommand(trimmed, turnId)) {
        return;
      }

      if (slashHandler(trimmed, session, skillRegistry)) {
        return;
      }

      const slashSkill = resolveSkillFromSlashInput(trimmed, skillStore);
      const suggestedSkill = slashSkill ? null : skillRegistry.trigger_match(trimmed);
      if (suggestedSkill) {
        turnTaskType = suggestedSkill.task_type;
      }
      const matchedSkill = slashSkill;
      if (matchedSkill) {
        turnTaskType = matchedSkill.task_type;
        const document = await skillStore.loadDocument(matchedSkill.id) ?? await skillStore.loadDocument(matchedSkill.name);
        if (!document) {
          const message = `Error: skill guidance not found: ${matchedSkill.name}`;
          emitRuntime({ type: 'error', message });
          session.add_message({ role: 'assistant', content: message });
          emitRuntime({ type: 'turn_completed', turnId, content: message });
          return;
        }

        const slashIntent = trimmed.replace(/^\S+\s*/, '').trim();
        const memorySystemMessages = await loadMemorySystemMessages(trimmed, memoryIndexStore, memoryTopicStore);
        const normalTurnSummary = await handle_normal_turn({
          taskType: turnTaskType,
          session,
          provider,
          skillRegistry,
          approvalHook,
          toolContext,
          isDebug,
          runtime,
          turnId,
          runtimeMetadata,
          extraSystemMessages: [
            ...memorySystemMessages,
            { role: 'system', content: buildLoadedSkillSystemMessage(document, slashIntent) },
          ],
        });
        await persistTurnMemory(trimmed, session, provider, memoryIndexStore, memoryTopicStore);
        void triggerLearningAfterTurn(turnTaskType, trimmed, buildLearningPayload(normalTurnSummary, {
          matched_skill_ids: [matchedSkill.id],
          used_skill_ids: [matchedSkill.id],
        }));
        return;
      }

      const memorySystemMessages = await loadMemorySystemMessages(trimmed, memoryIndexStore, memoryTopicStore);
      const normalTurnSummary = await handle_normal_turn({
        taskType: turnTaskType,
        session,
        provider,
        skillRegistry,
        approvalHook,
        toolContext,
        isDebug,
        runtime,
        turnId,
        runtimeMetadata,
        extraSystemMessages: memorySystemMessages,
      });
      await persistTurnMemory(trimmed, session, provider, memoryIndexStore, memoryTopicStore);
      void triggerLearningAfterTurn(turnTaskType, trimmed, buildLearningPayload(normalTurnSummary, {
        matched_skill_ids: suggestedSkill ? [suggestedSkill.id] : [],
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const userMessage = `Error: ${message}`;
      emitRuntime({ type: 'error', message: `Turn Error: ${message}` });
      session.add_message({ role: 'assistant', content: userMessage });
      emitRuntime({ type: 'turn_completed', turnId, content: userMessage });
    }
  };
}
