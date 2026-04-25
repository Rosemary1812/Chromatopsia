import type { LLMProvider, Skill, SkillDocument, SynthesisResult, TaskBufferEntry } from '../foundation/types.js';
import { parseSkillMarkdown } from '../skills/skill-parser.js';
import { buildLearningJudgePrompt } from './prompt.js';

interface SkillLookup {
  match(task_type: string): Skill | null;
  fuzzy_match(query: string): Skill[];
}

export interface LearningSynthesisInput {
  task_buffer: TaskBufferEntry[];
  last_task_type: string | null;
}

const DRAFT_SOURCE_PATH = '.chromatopsia/skills/drafts/generated/SKILL.md';

export async function synthesize_skill(
  input: LearningSynthesisInput,
  provider: LLMProvider,
  skill_reg?: SkillLookup,
): Promise<SynthesisResult> {
  const buffer_summary = summarize_task_buffer(input.task_buffer);

  let existing_skill_info = '';
  if (skill_reg) {
    const existing = input.last_task_type
      ? skill_reg.match(input.last_task_type)
      : null;
    if (existing) {
      existing_skill_info = `\nExisting related Skill: "${existing.name}" (id=${existing.id}). Choose patch if this batch improves or corrects that Skill; choose skip if the existing Skill already covers the behavior well.`;
    }
  }

  const prompt = buildLearningJudgePrompt({
    lastTaskType: input.last_task_type,
    bufferSummary: buffer_summary,
    existingSkillInfo: existing_skill_info,
  });

  const response = await provider.chat([{ role: 'user', content: prompt }]);
  return parse_synthesis_result(response.content);
}

export function summarize_task_buffer(buffer: TaskBufferEntry[]): string {
  if (buffer.length === 0) return '(empty)';
  return buffer
    .map((e, i) => {
      const toolNames = e.tool_calls.map((t) => t.name).join(' → ') || '(no tools)';
      const resultSummary = e.tool_results
        .map((r) => `${r.success ? 'ok' : 'fail'}:${r.output.replace(/\s+/g, ' ').trim().slice(0, 80)}`)
        .join(' | ');
      const skillSignals = [
        e.used_skill_ids?.length ? `used_skills=${e.used_skill_ids.join(',')}` : '',
        e.matched_skill_ids?.length ? `matched_skills=${e.matched_skill_ids.join(',')}` : '',
        e.skill_loads?.length ? `skill_loads=${e.skill_loads.join(',')}` : '',
        e.skill_feedback && e.skill_feedback !== 'none' ? `skill_feedback=${e.skill_feedback}` : '',
      ].filter(Boolean).join('; ');
      const turnSignals = [
        `tool_count=${e.tool_call_count ?? e.tool_calls.length}`,
        `errors=${e.error_count ?? e.tool_results.filter((result) => !result.success).length}`,
        `outcome=${e.final_outcome ?? 'unknown'}`,
        `complexity=${e.task_complexity_signal ?? ((e.tool_call_count ?? e.tool_calls.length) >= 5 ? 'complex' : 'simple')}`,
      ].join('; ');
      return `[${i + 1}] ${e.task_type}: ${turnSignals}; tools=${toolNames}; results=${resultSummary || '(no results)'}${skillSignals ? `; ${skillSignals}` : ''}`;
    })
    .join('\n');
}

export function parse_synthesis_result(content: string): SynthesisResult {
  const normalized = unwrapMarkdownFence(content).trim();

  try {
    const obj = JSON.parse(normalized) as Record<string, unknown>;
    if (!obj || Object.keys(obj).length === 0) {
      return { should_learn: false, skill: {}, reasoning: content };
    }

    if ('decision' in obj) {
      const decision = normalizeDecision(obj.decision);
      const rawDocument = typeof obj.skill_markdown === 'string'
        ? obj.skill_markdown
        : typeof obj.document === 'string'
          ? obj.document
          : typeof obj.rawDocument === 'string'
            ? obj.rawDocument
            : undefined;
      const parsedDocument = rawDocument ? parseSkillMarkdown(rawDocument, DRAFT_SOURCE_PATH) : null;
      const shouldLearn = (decision === 'create' || decision === 'patch') && Boolean(parsedDocument);
      return {
        should_learn: shouldLearn,
        decision,
        confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
        evidence: stringArray(obj.evidence),
        risk_notes: stringArray(obj.risk_notes),
        target_skill_id: typeof obj.target_skill_id === 'string' ? obj.target_skill_id : null,
        patch_plan: typeof obj.patch_plan === 'string' ? obj.patch_plan : undefined,
        skill: parsedDocument?.skill ?? (isPlainObject(obj.skill) ? obj.skill as Partial<Skill> : {}),
        document: parsedDocument ? toSkillDocument(parsedDocument) : undefined,
        rawDocument,
      };
    }

    if ('should_learn' in obj) {
      return {
        should_learn: false,
        decision: 'skip',
        confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
        skill: {},
      };
    }

    return { should_learn: false, skill: {}, reasoning: content };
  } catch {
    return { should_learn: false, skill: {}, reasoning: content };
  }
}

function unwrapMarkdownFence(content: string): string {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

function toSkillDocument(document: SkillDocument): SkillDocument {
  return {
    manifest: document.manifest,
    body: document.body,
    raw: document.raw,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDecision(value: unknown): 'skip' | 'create' | 'patch' {
  return value === 'create' || value === 'patch' ? value : 'skip';
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}
