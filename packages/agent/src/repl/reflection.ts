/**
 * REPL Reflection — Idle-triggered 反思状态机
 *
 * 当用户空闲超过 idle_timeout 毫秒后，触发 run_idle_reflection()。
 * 分析 task_buffer 累积的同类操作，必要时通过 LLM synthesis 生成新 Skill。
 */

import type {
  ReflectionState,
  TaskBufferEntry,
  SynthesisResult,
  Skill,
  LLMProvider,
} from '../foundation/types.js';

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

/** 默认 idle 超时阈值（ms） */
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/** 默认 TaskBuffer 上限 */
const DEFAULT_MAX_BUFFER_SIZE = 50;

/** 触发反思的连续操作次数阈值 */
const DEFAULT_REFLECTION_THRESHOLD = 3;

// ------------------------------------------------------------
// 核心函数
// ------------------------------------------------------------

/**
 * 用户空闲时触发反思。
 *
 * 条件：
 * 1. 当前不在反思中（in_progress = false）
 * 2. 距上次活跃 > idle_timeout 毫秒
 * 3. TaskBuffer 非空
 *
 * @param reflection - 当前反思状态
 * @param idle_timeout - 空闲超时阈值（ms），默认 30000
 * @returns SynthesisResult；如果不满足触发条件则返回 null
 */
export async function run_idle_reflection(
  reflection: ReflectionState,
  idle_timeout: number = DEFAULT_IDLE_TIMEOUT_MS,
): Promise<SynthesisResult | null> {
  // 条件1：不在反思中
  if (reflection.in_progress) {
    return null;
  }

  // 条件2：未达到空闲超时
  const now = Date.now();
  if (now - reflection.last_active_at < idle_timeout) {
    return null;
  }

  // 条件3：TaskBuffer 非空
  if (reflection.task_buffer.length === 0) {
    return null;
  }

  // 所有条件满足：返回 task_buffer 供 caller 发起 synthesis
  // Caller（如 loop.ts）负责调用 synthesize_skill 并处理结果
  return {
    skill: {},
    reasoning: `Idle reflection triggered: ${reflection.task_buffer.length} entries, type=${reflection.last_task_type}`,
  };
}

/**
 * 更新最后活跃时间。
 * 每次用户输入后调用，Reflection 完成后也调用。
 */
export function update_last_active(reflection: ReflectionState): void {
  reflection.last_active_at = Date.now();
}

/**
 * 判断是否应触发反思（基于 trigger_count）。
 *
 * @param reflection - 当前反思状态
 * @param task_type - 当前任务类型
 * @param threshold - 触发阈值，默认 3
 */
export function should_trigger_reflection(
  reflection: ReflectionState,
  task_type: string,
  threshold: number = DEFAULT_REFLECTION_THRESHOLD,
): boolean {
  // 仅当 task_type 与上次相同时才计数
  if (reflection.last_task_type !== task_type) {
    return false;
  }
  return reflection.trigger_count >= threshold;
}

/**
 * 将 TaskBufferEntry 数组添加到反思状态。
 * 同时更新 trigger_count 和 last_task_type。
 */
export function add_to_task_buffer(
  reflection: ReflectionState,
  entry: TaskBufferEntry,
): void {
  reflection.task_buffer.push(entry);

  if (reflection.last_task_type === entry.task_type) {
    reflection.trigger_count++;
  } else {
    reflection.last_task_type = entry.task_type;
    reflection.trigger_count = 1;
  }

  // 超过上限时移除最旧条目
  const maxSize = DEFAULT_MAX_BUFFER_SIZE;
  if (reflection.task_buffer.length > maxSize) {
    reflection.task_buffer.shift();
  }
}

/**
 * 重置反思状态（反思完成后调用）。
 */
export function reset_reflection(reflection: ReflectionState): ReflectionState {
  return {
    ...reflection,
    task_buffer: [],
    trigger_count: 0,
    in_progress: false,
    last_active_at: Date.now(),
  };
}

/**
 * 启动反思状态（进入 synthesis 阶段前调用）。
 */
export function start_reflection(reflection: ReflectionState): void {
  reflection.in_progress = true;
}

/**
 * 对 task_buffer 进行合成，生成新 Skill。
 *
 * @param reflection - 包含累积操作记录的反思状态
 * @param provider - LLM Provider
 * @param skill_reg - 技能注册表（用于获取已有技能避免重复）
 */
export async function synthesize_skill(
  reflection: ReflectionState,
  provider: LLMProvider,
  skill_reg?: {
    match(task_type: string): Skill | null;
    fuzzy_match(query: string): Skill[];
  },
): Promise<SynthesisResult> {
  const buffer_summary = summarize_task_buffer(reflection.task_buffer);

  // 检查是否有重复技能
  let existing_skill_info = '';
  if (skill_reg) {
    const existing = reflection.last_task_type
      ? skill_reg.match(reflection.last_task_type)
      : null;
    if (existing) {
      existing_skill_info = `\n注意：已存在同类技能 "${existing.name}"（id=${existing.id}），请勿重复生成。`;
    }
  }

  const prompt = `你观察到 Agent 在当前 session 中连续执行了多次同类操作但没有命中任何技能：

任务类型：${reflection.last_task_type ?? 'unknown'}
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

// ------------------------------------------------------------
// 辅助函数
// ------------------------------------------------------------

/**
 * 将 TaskBufferEntry 数组格式化为可读摘要。
 */
export function summarize_task_buffer(buffer: TaskBufferEntry[]): string {
  if (buffer.length === 0) return '(empty)';
  return buffer
    .map(
      (e, i) =>
        `[${i + 1}] ${e.task_type}: ${e.tool_calls.map((t) => t.name).join(' → ')}`,
    )
    .join('\n');
}

/**
 * 从 LLM 输出中解析 SynthesisResult。
 * 尝试 JSON 解析，失败时返回空 skill + 原文 reasoning。
 */
export function parse_synthesis_result(content: string): SynthesisResult {
  try {
    // 尝试提取 ```json ... ``` 块
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

/**
 * 创建初始 ReflectionState。
 */
export function create_reflection_state(): ReflectionState {
  return {
    in_progress: false,
    task_buffer: [],
    trigger_count: 0,
    last_task_type: null,
    last_active_at: Date.now(),
  };
}
