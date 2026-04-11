import type { Skill, TaskBufferEntry } from '../foundation/types.js';

export interface PatchAnalysis {
  new_pitfalls: string[];
  corrections: string[];
}

function analyze_failure(failed_buffer: TaskBufferEntry[]): PatchAnalysis {
  const toolNames = failed_buffer.flatMap((e) => e.tool_calls.map((tc) => tc.name));
  const errorMessages = failed_buffer
    .filter((e) => e.tool_results)
    .flatMap((e) => e.tool_results.map((r) => r.output))
    .filter((o) => !o.startsWith('ok') && !o.startsWith('OK'));

  const new_pitfalls: string[] = [];
  const corrections: string[] = [];

  for (const msg of errorMessages) {
    if (msg.includes('not found') || msg.includes('does not exist')) {
      new_pitfalls.push('操作前请确认目标文件或资源存在');
    }
    if (msg.includes('permission denied') || msg.includes('EACCES')) {
      new_pitfalls.push('注意权限问题，必要时使用 sudo 或检查文件权限');
    }
    if (msg.includes('conflict') || msg.includes('CONFLICT')) {
      new_pitfalls.push('存在冲突，请先解决冲突再继续');
      corrections.push('遇到冲突时，先用 git status 查看冲突文件，人工解决后再执行后续操作');
    }
    if (msg.includes('timeout') || msg.includes('TIMEOUT')) {
      new_pitfalls.push('操作可能超时，建议增加 timeout 参数或分步执行');
    }
  }

  if (toolNames.includes('git') && errorMessages.length > 0) {
    new_pitfalls.push('git 操作失败时，用 git status 和 git log 查看当前状态');
  }

  return {
    new_pitfalls: [...new Set(new_pitfalls)],
    corrections: [...new Set(corrections)],
  };
}

function merge_steps(existing: string[], corrections: string[]): string[] {
  const merged = [...existing];
  for (const corr of corrections) {
    if (!merged.includes(corr)) {
      merged.push(corr);
    }
  }
  return merged;
}

export class SkillPatcher {
  async patch(skill: Skill, failed_buffer: TaskBufferEntry[]): Promise<void> {
    const analysis = analyze_failure(failed_buffer);

    for (const pitfall of analysis.new_pitfalls) {
      if (!skill.pitfalls.includes(pitfall)) {
        skill.pitfalls.push(pitfall);
      }
    }

    skill.steps = merge_steps(skill.steps, analysis.corrections);
    skill.updated_at = Date.now();
    skill.call_count++;
  }
}
