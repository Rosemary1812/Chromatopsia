export interface LearningJudgePromptInput {
  lastTaskType: string | null;
  bufferSummary: string;
  existingSkillInfo?: string;
  generatedAt?: string;
}

export function buildLearningJudgePrompt(input: LearningJudgePromptInput): string {
  const taskType = input.lastTaskType ?? 'unknown';
  const skillTaskType = input.lastTaskType ?? 'general';
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  return `You are the Learning Judge for an agent skill system.

You are given a batch of recent turn events from one session.

Task type: ${taskType}
Turn event summary:
${input.bufferSummary}
${input.existingSkillInfo ?? ''}

Decide whether this batch contains reusable operational knowledge that should become a skill, patch an existing skill, or be ignored.

Learning triggers:
1. A complex task was completed, especially if it required 5+ tool calls.
2. A tricky error was diagnosed or fixed.
3. A non-trivial workflow, setup procedure, debugging path, release process, or tool usage pattern was discovered.
4. The agent repeatedly performed similar operations without useful Skill guidance.
5. An existing Skill was used but found outdated, incomplete, misleading, or wrong.

Do not create or patch a skill for:
1. One-off project/session facts with no reuse value.
2. Trivial commands or obvious steps.
3. Failed attempts where the correct approach is still unclear.
4. Behavior already covered well by an existing active Skill.
5. Sensitive credentials, private tokens, or user-private content.

Evaluate reusability, specificity, stability, evidence, and whether this should be create, patch, or skip.

Return strict JSON only. The "decision" value must be exactly one of "create", "patch", or "skip":
{
  "decision": "create",
  "confidence": 0.9,
  "reasoning": "short explanation",
  "target_skill_id": null,
  "evidence": ["short evidence item from the batch"],
  "risk_notes": ["possible reason this learning could be wrong or too narrow"],
  "skill_markdown": "complete SKILL.md only if decision=create or decision=patch",
  "patch_plan": "concise patch plan only if decision=patch"
}

If decision is "create" or "patch", skill_markdown must be a complete SKILL.md document in this format:
---
id: kebab-case-skill-id
name: 简短技能名称
description: 何时使用这个 skill 的一句话说明
user-invocable: true
context: inline
triggers:
  - 用户可能说出的触发描述
task_type: ${skillTaskType}
scope: learning_draft
enabled: false
priority: 10
version: 1
updated_at: ${generatedAt}
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
5. For patch, target_skill_id must identify the active Skill being revised.

输出：`;
}
