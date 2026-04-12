import type { LLMProvider, Skill, SynthesisResult, TaskBufferEntry } from '../foundation/types.js';

interface SkillLookup {
  match(task_type: string): Skill | null;
  fuzzy_match(query: string): Skill[];
}

export interface LearningSynthesisInput {
  task_buffer: TaskBufferEntry[];
  last_task_type: string | null;
}

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

  const prompt = `你观察到 Agent 在当前 session 中连续执行了多次同类操作但没有命中任何技能：

任务类型：${input.last_task_type ?? 'unknown'}
操作序列：
${buffer_summary}
${existing_skill_info}

请反思：
1. 这些操作的共同目标是什么？
2. 标准化的步骤应该是什么？（至少 3 步）
3. 常见的陷阱有哪些？（至少 2 条）
4. 如何验证操作是否成功？

如果这些操作值得固化为可复用技能，请以 JSON 格式返回一个 Skill 对象，字段包括：
id, name, trigger_condition, trigger_pattern（可选）, steps, pitfalls, verification, task_type, created_at, updated_at, call_count, success_count。

如果只是一次性操作不值得固化，返回空对象 {}。

JSON 输出：`;

  const response = await provider.chat([{ role: 'user', content: prompt }]);
  return parse_synthesis_result(response.content);
}

export function summarize_task_buffer(buffer: TaskBufferEntry[]): string {
  if (buffer.length === 0) return '(empty)';
  return buffer
    .map(
      (e, i) =>
        `[${i + 1}] ${e.task_type}: ${e.tool_calls.map((t) => t.name).join(' → ')}`,
    )
    .join('\n');
}

export function parse_synthesis_result(content: string): SynthesisResult {
  try {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

    const obj = JSON.parse(jsonStr);
    if (!obj || Object.keys(obj).length === 0) {
      return { skill: {}, reasoning: content };
    }
    return {
      skill: obj as Partial<Skill>,
      reasoning: '',
    };
  } catch {
    return { skill: {}, reasoning: content };
  }
}
