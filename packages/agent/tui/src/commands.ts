import type {
  SlashCommand,
  TuiCommandSource,
  TuiCommandContext,
  TuiCommandMatch,
  TuiStoreLike,
} from './types.js';

export interface DynamicSlashCommandSeed {
  input: string;
  description: string;
  source?: TuiCommandSource;
}

export interface DraftSkillCommandSeed {
  id: string;
  name: string;
  task_type: string;
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    input: '/help',
    description: 'Show available commands',
    source: 'builtin',
    execute: (store) => {
      store.appendCommandHelp();
    },
  },
  {
    input: '/clear',
    description: 'Clear current conversation',
    source: 'builtin',
    execute: async (store, context) => {
      store.clearTranscript();
      store.hideCommandHelp();
      await context?.clearConversation?.();
    },
  },
  {
    input: '/exit',
    description: 'Exit Chromatopsia',
    source: 'builtin',
    execute: async (_store, context) => {
      await context?.exit?.();
    },
  },
  {
    input: '/theme dark',
    description: 'Switch to dark theme',
    source: 'builtin',
    execute: (store) => {
      store.setThemeMode('dark');
    },
  },
  {
    input: '/theme light',
    description: 'Switch to light theme',
    source: 'builtin',
    execute: (store) => {
      store.setThemeMode('light');
    },
  },
  {
    input: '/skill review',
    description: 'List pending draft skills',
    source: 'learning',
    execute: undefined,
  },
];

export function listBuiltinCommands(): SlashCommand[] {
  return [...BUILTIN_COMMANDS];
}

export function buildDynamicSlashCommands(
  skillCommands: DynamicSlashCommandSeed[] = [],
  draftSkills: DraftSkillCommandSeed[] = [],
): SlashCommand[] {
  const commands: SlashCommand[] = [];

  for (const draft of draftSkills) {
    commands.push({
      input: `/skill approve ${draft.id}`,
      description: `Approve draft skill "${draft.name}" [${draft.task_type}]`,
      source: 'learning',
      execute: undefined,
    });
    commands.push({
      input: `/skill reject ${draft.id}`,
      description: `Reject draft skill "${draft.name}" [${draft.task_type}]`,
      source: 'learning',
      execute: undefined,
    });
  }

  for (const command of skillCommands) {
    commands.push({
      input: command.input,
      description: command.description,
      source: command.source ?? 'skill',
      execute: undefined,
    });
  }

  return commands;
}

export function mergeSlashCommands(commands: SlashCommand[] = []): SlashCommand[] {
  const merged = new Map<string, SlashCommand>();

  for (const command of [...BUILTIN_COMMANDS, ...commands]) {
    const key = command.input.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, command);
    }
  }

  return [...merged.values()].sort((left, right) => left.input.localeCompare(right.input));
}

export function formatBuiltinCommandHelp(commands: SlashCommand[] = BUILTIN_COMMANDS): string {
  const lines = ['Commands'];
  for (const command of commands) {
    lines.push(`  ${command.input.padEnd(24, ' ')} ${command.description}`);
  }
  return lines.join('\n');
}

export function matchBuiltinCommand(input: string, commands: SlashCommand[] = BUILTIN_COMMANDS): TuiCommandMatch | null {
  const trimmed = input.trim();
  const command = commands.find((item) => item.input.toLowerCase() === trimmed.toLowerCase() && item.execute);
  if (!command) return null;
  return { command, raw: trimmed };
}

export async function executeBuiltinCommand(
  input: string,
  store: TuiStoreLike,
  context?: TuiCommandContext,
  commands: SlashCommand[] = BUILTIN_COMMANDS,
): Promise<boolean> {
  const matched = matchBuiltinCommand(input, commands);
  if (!matched) return false;
  await matched.command.execute?.(store, context);
  store.setPendingInput('');
  return true;
}
