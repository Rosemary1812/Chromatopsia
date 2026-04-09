/**
 * Session Context Building Pipeline
 *
 * Builds the message context sent to the LLM:
 * 1. System prompt (with project context, user context)
 * 2. Skill injection (matched skill or fuzzy-matched related skills)
 * 3. Recent conversation history
 */

import type { Message, Session, Skill, LLMContext } from '../types.js';
import type { SkillRegistry } from '../skills/registry.js';

// ----------------------------------------------------------------
// System prompt building
// ----------------------------------------------------------------

/**
 * Build the system prompt for a session.
 * Includes project context, user context, and agent role definition.
 */
export function build_system_prompt(session: Session): string {
  const parts: string[] = [
    '你是 Chromatopsia，一个面向开发者的 AI 编程助手。',
    '你可以使用工具来读取、编辑、搜索文件和执行命令。',
    '始终优先使用工具完成任务，而非仅仅描述如何做。',
  ];

  if (session.project_context) {
    const ctx = session.project_context;
    parts.push('');
    parts.push(`【项目】${ctx.name}`);
    parts.push(`根目录：${ctx.root}`);
    if (ctx.language) parts.push(`语言：${ctx.language}`);
    if (ctx.framework) parts.push(`框架：${ctx.framework}`);
    if (ctx.description) parts.push(`描述：${ctx.description}`);
  }

  if (session.user_context) {
    const uc = session.user_context;
    parts.push('');
    if (uc.name) parts.push(`用户：${uc.name}`);
    if (uc.preferences) {
      const entries = Object.entries(uc.preferences);
      if (entries.length > 0) {
        parts.push('用户偏好：');
        for (const [k, v] of entries) {
          parts.push(`  ${k}: ${v}`);
        }
      }
    }
  }

  return parts.join('\n');
}

// ----------------------------------------------------------------
// Skill injection
// ----------------------------------------------------------------

/**
 * Build a skill injection block for a precisely matched skill.
 */
export function build_skill_injection(skill: Skill): string {
  const lines: string[] = [];
  lines.push(`【技能】${skill.name}`);
  lines.push(`触发条件：${skill.trigger_condition}`);
  lines.push('步骤：');
  for (let i = 0; i < skill.steps.length; i++) {
    lines.push(`  ${i + 1}. ${skill.steps[i]}`);
  }
  if (skill.pitfalls.length > 0) {
    lines.push('常见陷阱：');
    for (const p of skill.pitfalls) {
      lines.push(`  - ${p}`);
    }
  }
  if (skill.verification) {
    lines.push(`验证方法：${skill.verification}`);
  }
  return lines.join('\n');
}

/**
 * Build a related skill block for fuzzy-matched skills (no precise match).
 * Only includes top 3 to avoid context bloat.
 */
export function build_related_skills_injection(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const lines: string[] = ['【相关经验】'];
  for (const skill of skills.slice(0, 3)) {
    lines.push(`- ${skill.name}：${skill.trigger_condition}`);
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------
// Message formatting
// ----------------------------------------------------------------

/**
 * Format recent messages for inclusion in LLM context.
 * Only includes user and assistant messages (not tool results).
 * Adds a reasonable limit to avoid context overflow.
 */
export function format_recent_messages(messages: Message[], limit: number = 20): string {
  const filtered = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const recent = filtered.slice(-limit);

  if (recent.length === 0) return '';

  const lines: string[] = [];
  lines.push('【对话历史】');
  for (const msg of recent) {
    const prefix = msg.role === 'user' ? '用户' : '助手';
    lines.push(`${prefix}：${msg.content}`);
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------
// Main context builder
// ----------------------------------------------------------------

export interface BuildLLMContextOptions {
  /** Maximum number of recent messages to include */
  max_recent_messages?: number;
}

/**
 * Build the full LLM context for a session.
 *
 * @param session       - The active session
 * @param task_type     - Inferred task type (for skill matching)
 * @param matched_skill - Precisely matched skill (from SkillRegistry.match)
 * @param skill_reg     - Skill registry for fuzzy lookups
 * @param options       - Optional configuration
 * @returns LLMContext ready to be passed to the LLM provider
 */
export function build_llm_context(
  session: Session,
  task_type: string,
  matched_skill: Skill | null,
  skill_reg: SkillRegistry,
  options: BuildLLMContextOptions = {},
): LLMContext {
  const { max_recent_messages = 20 } = options;
  const chunks: string[] = [];
  let fullResponse: { content: string; tool_calls?: import('../types.js').ToolCall[]; finish_reason: 'stop' | 'tool_use' } | null = null;

  const messages: Message[] = [];

  // 1. System prompt
  const system_prompt = build_system_prompt(session);
  messages.push({ role: 'system', content: system_prompt });

  // 2. Skill injection
  if (matched_skill) {
    const skill_block = build_skill_injection(matched_skill);
    messages.push({ role: 'system', content: skill_block });
  } else {
    // Fuzzy match — no precise hit, show related skills
    const related = skill_reg.fuzzy_match(task_type).slice(0, 3);
    if (related.length > 0) {
      const related_block = build_related_skills_injection(related);
      if (related_block) {
        messages.push({ role: 'system', content: related_block });
      }
    }
  }

  // 3. Recent messages
  const recent_block = format_recent_messages(session.messages, max_recent_messages);
  if (recent_block) {
    // Format recent messages as a user/system message block
    // We prepend it as a system message for context
    messages.push({ role: 'system', content: recent_block });
  }

  return {
    messages,
    appendAssistantChunk: (chunk: string) => {
      chunks.push(chunk);
    },
    finalizeStream: () => {
      if (fullResponse) return fullResponse;
      fullResponse = {
        content: chunks.join(''),
        finish_reason: 'stop',
      };
      return fullResponse;
    },
    showNotification: (msg: string) => {
      // No-op in pure context builder; handled by REPL loop
      console.log(`[notification] ${msg}`);
    },
    finishAssistantMessage: (content: string) => {
      session.add_message({ role: 'assistant', content });
    },
  };
}
