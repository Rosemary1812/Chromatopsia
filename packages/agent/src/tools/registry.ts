import type { ToolDefinition } from '../types.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  get_all(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  get_dangerous(): ToolDefinition[] {
    // danger_level >= warning (i.e., 'warning' or 'dangerous')
    return this.get_all().filter(
      (t) => t.danger_level === 'warning' || t.danger_level === 'dangerous'
    );
  }
}

export const registry = new ToolRegistry();
