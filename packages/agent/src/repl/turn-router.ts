import { randomUUID } from 'crypto';
import type {
  LLMProvider,
  RuntimeAgentRole,
  RuntimeSink,
  Session,
  Skill,
  SkillManifestEntry,
  ToolCall,
  ToolContext,
  ToolResult,
} from '../foundation/types.js';
import type { RuntimeEventInput } from './runtime.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { SkillStore } from '../skills/store.js';
import type { ApprovalHook } from '../hooks/approval.js';
import type { MemoryIndexStore } from '../memory/index-store.js';
import type { MemoryTopicStore } from '../memory/topic-store.js';
import { execute_skill } from './executor.js';
import { createApprovalRequestHandler } from './approval-bridge.js';
import { handle_normal_turn } from './normal-turn.js';
import { loadMemorySystemMessages, persistTurnMemory } from './turn-hooks.js';

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

export function summarize_skill_results(
  skill: Skill,
  results: ToolResult[],
): string {
  if (results.length === 0) {
    return `Skill "${skill.name}" ran, but it produced no step results.`;
  }

  const failed: Array<{ index: number; result: ToolResult }> = [];
  const succeeded: Array<{ index: number; result: ToolResult }> = [];

  for (const [index, result] of results.entries()) {
    if (result.success) {
      succeeded.push({ index, result });
    } else {
      failed.push({ index, result });
    }
  }

  const lines: string[] = [];
  if (failed.length > 0) {
    lines.push(`Skill "${skill.name}" failed.`);
    for (const item of failed) {
      const output = item.result.output?.trim() || 'Unknown error.';
      lines.push(`- Step ${item.index + 1} failed: ${output}`);
    }
    if (succeeded.length > 0) {
      lines.push(`Succeeded steps: ${succeeded.map((item) => item.index + 1).join(', ')}`);
    }
    return lines.join('\n');
  }

  lines.push(`Skill "${skill.name}" completed successfully.`);
  for (const item of succeeded) {
    const output = item.result.output?.trim();
    lines.push(`- Step ${item.index + 1}: ${output || 'Done.'}`);
  }
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
          description: `Run skill: ${skill.name}`,
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
      if (drafts.length === 0) {
        emitRuntime({ type: 'turn_completed', turnId, content: 'No draft skills pending review.' });
      } else {
        const lines = drafts.map((d) => `- ${d.id}: ${d.name} [${d.task_type}]`);
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
          source_path: `.chromatopsia/skills/user/${approved.id}.md`,
        });
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
    payload?: { tool_calls?: ToolCall[]; tool_results?: ToolResult[] },
  ) => Promise<void>;
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

      const matchedSkill = resolveSkillFromSlashInput(trimmed, skillStore) ?? skillRegistry.trigger_match(trimmed);
      if (matchedSkill) {
        turnTaskType = matchedSkill.task_type;
        const skillApprovalRequestHandler = createApprovalRequestHandler({
          runtime,
          approvalHook,
          emitRuntime,
          turnId,
        });
        const skillToolCalls: ToolCall[] = [];
        const results = await execute_skill(
          matchedSkill,
          toolContext,
          approvalHook,
          skillApprovalRequestHandler,
          {
            onToolStart: (toolCall) => {
              skillToolCalls.push(toolCall);
              emitRuntime({ type: 'tool_started', turnId, toolCall });
            },
            onToolEnd: (toolCall, result) => {
              emitRuntime({ type: 'tool_finished', turnId, toolCall, result });
            },
          },
        );
        if (skillToolCalls.length > 0) {
          emitRuntime({ type: 'tool_batch_finished', turnId, toolCalls: skillToolCalls, results });
        }
        for (const result of results) {
          if (result.success) {
            emitRuntime({ type: 'notification', message: `[${matchedSkill.name}] Step succeeded` });
          } else {
            emitRuntime({ type: 'notification', message: `[${matchedSkill.name}] Step failed: ${result.output}` });
          }
        }
        const skillSummary = summarize_skill_results(matchedSkill, results);
        session.add_message({
          role: 'assistant',
          content: skillSummary,
        });
        emitRuntime({ type: 'assistant_message', turnId, content: skillSummary });
        await persistTurnMemory(trimmed, session, provider, memoryIndexStore, memoryTopicStore);
        emitRuntime({ type: 'turn_completed', turnId, content: skillSummary });
        void triggerLearningAfterTurn(turnTaskType, trimmed, {
          tool_calls: skillToolCalls,
          tool_results: results,
        });
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
      void triggerLearningAfterTurn(turnTaskType, trimmed, {
        tool_calls: normalTurnSummary.toolCalls,
        tool_results: normalTurnSummary.toolResults,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const userMessage = `Error: ${message}`;
      emitRuntime({ type: 'error', message: `Turn Error: ${message}` });
      session.add_message({ role: 'assistant', content: userMessage });
      emitRuntime({ type: 'turn_completed', turnId, content: userMessage });
    }
  };
}
