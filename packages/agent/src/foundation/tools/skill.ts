import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';
import type { SkillStore } from '../../skills/store.js';

interface SkillArgs {
  name: string;
  args?: string;
}

function formatSkillToolResult(name: string, body: string, args?: string): string {
  const lines = [`Skill "${name}" loaded.`, ''];
  if (args && args.trim()) {
    lines.push(`User intent/context: ${args.trim()}`, '');
  }
  lines.push('<skill markdown body>', body.trim(), '</skill markdown body>');
  return lines.join('\n');
}

export function create_skill_definition(skillStore: SkillStore): ToolDefinition {
  async function skill_handler(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const { name, args: userArgs } = args as unknown as SkillArgs;
    if (!name || typeof name !== 'string') {
      return {
        tool_call_id: '',
        output: 'Error: name is required and must be a string',
        success: false,
      };
    }

    const document = await skillStore.loadDocument(name);
    if (!document || document.manifest.scope === 'learning_draft' || !document.manifest.enabled) {
      return {
        tool_call_id: '',
        output: `Error: skill not found or not available: ${name}`,
        success: false,
      };
    }

    return {
      tool_call_id: '',
      output: formatSkillToolResult(document.manifest.name, document.body, typeof userArgs === 'string' ? userArgs : undefined),
      success: true,
    };
  }

  return {
    name: 'Skill',
    description: 'Load the full SKILL.md guidance for an available skill by name. Use this before applying a skill; the result is guidance, not an executable macro.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name or id from the available skills list.',
        },
        args: {
          type: 'string',
          description: 'Optional user intent or task context to carry with the loaded guidance.',
        },
      },
      required: ['name'],
    },
    danger_level: 'safe',
    handler: skill_handler,
  };
}
