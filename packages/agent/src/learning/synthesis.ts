import type { LLMProvider, Skill, SkillDocument, SynthesisResult, TaskBufferEntry } from '../foundation/types.js';
import { parseSkillMarkdown } from '../skills/skill-parser.js';

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
      existing_skill_info = `\n注意：已存在同类技能 "${existing.name}"（id=${existing.id}），请勿重复生成。`;
    }
  }

  const prompt = `你观察到 Agent 在当前 session 中连续执行了多次同类操作但没有命中任何 Skill guidance：

任务类型：${input.last_task_type ?? 'unknown'}
操作序列：
${buffer_summary}
${existing_skill_info}

请判断这些操作是否值得沉淀成一个 Claude Code 风格的 Skill guidance。

如果不值得沉淀，请只输出 JSON：
{"should_learn":false,"confidence":0-1,"reasoning":"简短判断理由"}

如果值得沉淀，请只输出一个完整的 SKILL.md 文档，不要包裹 JSON，不要输出解释。格式必须是：
---
id: kebab-case-skill-id
name: 简短技能名称
description: 何时使用这个 skill 的一句话说明
user-invocable: true
context: inline
triggers:
  - 用户可能说出的触发描述
task_type: ${input.last_task_type ?? 'general'}
scope: learning_draft
enabled: false
priority: 10
version: 1
updated_at: ${new Date().toISOString()}
---

# 技能标题

## When To Use
说明适用场景和判断信号。

## Procedure
用自然语言描述推荐策略、必要上下文和执行顺序。不要写可执行 tool macro，不要写 \`run_shell key=value\` 这类步骤。

## Pitfalls
列出常见坑和需要避免的行为。

## Verification
说明如何验证任务完成。

要求：
1. 正文必须是 Markdown guidance，不是 JSON skill object。
2. 不要输出 steps/pitfalls 数组，也不要要求系统重放工具调用。
3. id 必须稳定、短小、kebab-case。
4. description 和 triggers 应帮助模型判断何时调用 Skill tool。

输出：`;

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
      return `[${i + 1}] ${e.task_type}: tools=${toolNames}; results=${resultSummary || '(no results)'}`;
    })
    .join('\n');
}

export function parse_synthesis_result(content: string): SynthesisResult {
  const normalized = unwrapMarkdownFence(content).trim();
  const document = parseSkillMarkdown(normalized, DRAFT_SOURCE_PATH);
  if (document) {
    return {
      should_learn: true,
      skill: document.skill,
      document: toSkillDocument(document),
      rawDocument: normalized,
    };
  }

  try {
    const obj = JSON.parse(normalized) as Record<string, unknown>;
    if (!obj || Object.keys(obj).length === 0) {
      return { should_learn: false, skill: {}, reasoning: content };
    }

    if ('should_learn' in obj) {
      const rawDocument = typeof obj.document === 'string'
        ? obj.document
        : typeof obj.rawDocument === 'string'
          ? obj.rawDocument
          : undefined;
      const parsedDocument = rawDocument ? parseSkillMarkdown(rawDocument, DRAFT_SOURCE_PATH) : null;
      return {
        should_learn: obj.should_learn === true && Boolean(parsedDocument),
        confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
        skill: parsedDocument?.skill ?? (isPlainObject(obj.skill) ? obj.skill as Partial<Skill> : {}),
        document: parsedDocument ? toSkillDocument(parsedDocument) : undefined,
        rawDocument,
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
