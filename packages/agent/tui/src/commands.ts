import type {
  BuiltinCommand,
  TuiCommandContext,
  TuiCommandMatch,
  TuiStoreLike,
} from './types.js';

const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: 'help',
    description: 'Show available commands',
    execute: (store) => {
      store.appendCommandHelp();
    },
  },
  {
    name: 'clear',
    description: 'Clear current conversation',
    execute: async (store, context) => {
      store.clearTranscript();
      store.hideCommandHelp();
      await context?.clearConversation?.();
    },
  },
  {
    name: 'exit',
    description: 'Exit Chromatopsia',
    execute: async (_store, context) => {
      await context?.exit?.();
    },
  },
];

export function listBuiltinCommands(): BuiltinCommand[] {
  return [...BUILTIN_COMMANDS];
}

export function formatBuiltinCommandHelp(commands: BuiltinCommand[] = BUILTIN_COMMANDS): string {
  const lines = ['Commands'];
  for (const command of commands) {
    lines.push(`  /${command.name.padEnd(5, ' ')} ${command.description}`);
  }
  return lines.join('\n');
}

export function matchBuiltinCommand(input: string, commands: BuiltinCommand[] = BUILTIN_COMMANDS): TuiCommandMatch | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^\/([^\s]+)(?:\s.*)?$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const command = commands.find((item) => item.name.toLowerCase() === name);
  if (!command) return null;
  return { command, raw: trimmed };
}

export async function executeBuiltinCommand(
  input: string,
  store: TuiStoreLike,
  context?: TuiCommandContext,
  commands: BuiltinCommand[] = BUILTIN_COMMANDS,
): Promise<boolean> {
  const matched = matchBuiltinCommand(input, commands);
  if (!matched) return false;
  await matched.command.execute(store, context);
  store.setPendingInput('');
  return true;
}
