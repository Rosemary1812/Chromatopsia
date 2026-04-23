/**
 * Session Context Building Pipeline
 *
 * Builds the message context sent to the LLM:
 * 1. System prompt (with project context, user context)
 * 2. Skill directory listing and explicitly loaded skill guidance
 * 3. Recent conversation history
 */

import type { Message, Session, Skill, LLMContext } from '../foundation/types.js';
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
// Message formatting
// ----------------------------------------------------------------
// Main context builder
// ----------------------------------------------------------------

export function build_llm_context(
  session: Session,
  task_type: string,
  _matched_skill: Skill | null,
  skill_reg: SkillRegistry,
  extra_system_messages: Message[] = [],
): LLMContext {
  void task_type;
  const chunks: string[] = [];
  let capturedToolCalls: import('../foundation/types.js').ToolCall[] = [];
  let fullResponse: { content: string; tool_calls?: import('../foundation/types.js').ToolCall[]; finish_reason: 'stop' | 'tool_use' } | null = null;

  const messages: Message[] = [];

  // 1. System prompt
  const system_prompt = build_system_prompt(session);
  messages.push({ role: 'system', content: system_prompt });
  for (const msg of extra_system_messages) {
    if (msg.role === 'system') {
      messages.push({ role: 'system', content: msg.content });
    }
  }

  // 2. Skill directory. Full guidance is injected only by slash skill preloading or the Skill tool.
  const directoryListing = skill_reg.build_directory_listing();
  if (directoryListing) {
    messages.push({ role: 'system', content: directoryListing });
  }

  // 3. Conversation history, including persisted summaries stored as system messages
  for (const msg of session.messages) {
    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool' || msg.role === 'system') {
      messages.push({
        role: msg.role,
        content: msg.content,
        tool_calls: msg.tool_calls,
        tool_results: msg.tool_results,
      });
    }
  }

  return {
    messages,
    appendAssistantChunk: (chunk: string) => {
      chunks.push(chunk);
    },
    setToolCalls: (tool_calls) => {
      capturedToolCalls = tool_calls;
    },
    finalizeStream: () => {
      if (fullResponse) return fullResponse;
      fullResponse = {
        content: chunks.join(''),
        tool_calls: capturedToolCalls.length > 0 ? capturedToolCalls : undefined,
        finish_reason: capturedToolCalls.length > 0 ? 'tool_use' : 'stop',
      };
      return fullResponse;
    },
    showNotification: (_msg: string) => {
      // Pure function: no side effects. Caller (loop) routes via events.
    },
    finishAssistantMessage: (content: string) => {
      session.add_message({ role: 'assistant', content });
    },
  };
}
