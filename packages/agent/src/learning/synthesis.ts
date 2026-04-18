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

请严格输出 JSON，对象格式如下：
{
  "should_learn": boolean,
  "confidence": 0-1,
  "reasoning": "简短判断理由",
  "skill": {
    "id": "skill-id",
    "name": "技能名称",
    "trigger_condition": "触发条件",
    "trigger_pattern": "可选正则",
    "steps": ["步骤1", "步骤2", "步骤3"],
    "pitfalls": ["陷阱1", "陷阱2"],
    "verification": "验证方式",
    "task_type": "任务类型"
  }
}

要求：
1. 如果不值得沉淀，返回 {"should_learn": false, "confidence": x, "reasoning": "...", "skill": {}}。
2. confidence 必须是 0 到 1 的数字。
3. skill.steps 必须是可执行的工具步骤，不要写自然语言描述。
4. 除了上面这些字段，不要输出额外字段。

JSON 输出：`;

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
  try {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    if (!obj || Object.keys(obj).length === 0) {
      return { should_learn: false, skill: {}, reasoning: content };
    }

    if ('should_learn' in obj) {
      return {
        should_learn: obj.should_learn === true,
        confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
        skill: isPlainObject(obj.skill) ? obj.skill as Partial<Skill> : {},
      };
    }

    return {
      skill: obj as Partial<Skill>,
      should_learn: true,
    };
  } catch {
    return { should_learn: false, skill: {}, reasoning: content };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
