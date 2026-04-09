/**
 * Slash Command System — 斜杠命令解析与分发
 * T-22
 *
 * 职责：
 * - 解析用户输入中的斜杠命令
 * - 分发到对应的 handler（Session / SkillRegistry 方法）
 * - 提供帮助文本
 */

import type { Session, SkillRegistry } from '@chromatopsia/agent';

export interface SlashHandlerArgs {
  session: Session;
  skill_reg: SkillRegistry;
  args: string[];
}

export type SlashHandler = (args: SlashHandlerArgs) => void | Promise<void>;

export interface SlashCommand {
  description: string;
  handler: SlashHandler;
}

export const SLASH_COMMANDS: Record<string, SlashCommand> = {
  '/exit': {
    description: '退出程序',
    handler: () => {
      process.exit(0);
    },
  },
  '/quit': {
    description: '退出程序',
    handler: () => {
      process.exit(0);
    },
  },
  '/clear': {
    description: '清空当前 session 历史',
    handler: ({ session }) => {
      session.clear();
    },
  },
  '/skills': {
    description: '列出所有已加载技能',
    handler: ({ skill_reg }) => {
      skill_reg.list();
    },
  },
  '/skill': {
    description: '查看指定技能详情 /skill <name>',
    handler: ({ skill_reg, args }) => {
      skill_reg.show(args[0] ?? '');
    },
  },
  '/forget': {
    description: '删除一个技能 /forget <name>',
    handler: ({ skill_reg, args }) => {
      skill_reg.delete(args[0] ?? '');
    },
  },
  '/compact': {
    description: '手动压缩当前 session 上下文',
    handler: ({ session }) => {
      session.compact();
    },
  },
  '/search': {
    description: '搜索历史经验 /search <query>',
    handler: ({ skill_reg, args }) => {
      skill_reg.search(args.join(' '));
    },
  },
  '/help': {
    description: '显示帮助信息',
    handler: () => {
      console.log(get_help_text());
    },
  },
};

export function get_help_text(): string {
  const lines = ['可用命令：'];
  for (const [cmd, meta] of Object.entries(SLASH_COMMANDS)) {
    lines.push(`  ${cmd} — ${meta.description}`);
  }
  return lines.join('\n');
}

/**
 * 解析并执行斜杠命令
 * @param input 用户输入
 * @param session 当前会话
 * @param skill_reg 技能注册表
 * @returns true if command was handled, false otherwise
 */
export function handle_slash_command(
  input: string,
  session: Session,
  skill_reg: SkillRegistry,
): boolean {
  const trimmed = input.trim();

  for (const [cmd, meta] of Object.entries(SLASH_COMMANDS)) {
    if (trimmed.startsWith(cmd)) {
      const after = trimmed.slice(cmd.length).trim();
      const args = after ? after.split(/\s+/) : [];
      meta.handler({ session, skill_reg, args });
      return true;
    }
  }

  return false;
}
