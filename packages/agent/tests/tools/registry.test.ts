/**
 * ToolRegistry 单元测试
 *
 * 测试范围：
 * 1. 注册一个 tool
 * 2. 重复注册（后者覆盖前者）
 * 3. 查询已注册的 tool
 * 4. 查询不存在的 tool（返回 undefined）
 * 5. get_all() 返回所有已注册 tool
 * 6. get_dangerous() 返回 danger_level >= warning 的 tool
 * 7. 空注册表 get_all() 返回空数组
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ToolDefinition } from '../../src/types.js';

function makeTool(name: string, dangerLevel?: 'safe' | 'warning' | 'dangerous'): ToolDefinition {
  return {
    name,
    description: `description for ${name}`,
    input_schema: { type: 'object' as const },
    danger_level: dangerLevel,
    handler: async () => ({ tool_call_id: '1', output: 'ok', success: true }),
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers a tool', () => {
    const tool = makeTool('test_tool');
    registry.register(tool);
    expect(registry.get('test_tool')).toBe(tool);
  });

  it('re-registers a tool (latter overwrites former)', () => {
    const first = makeTool('dup_tool', 'safe');
    const second = makeTool('dup_tool', 'dangerous');
    registry.register(first);
    registry.register(second);
    expect(registry.get('dup_tool')).toBe(second);
  });

  it('gets an existing tool', () => {
    const tool = makeTool('get_tool');
    registry.register(tool);
    expect(registry.get('get_tool')).toBe(tool);
  });

  it('returns undefined for non-existent tool', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('get_all() returns all registered tools', () => {
    registry.register(makeTool('tool_a'));
    registry.register(makeTool('tool_b'));
    const all = registry.get_all();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.name)).toContain('tool_a');
    expect(all.map((t) => t.name)).toContain('tool_b');
  });

  it('get_all() returns empty array when nothing registered', () => {
    expect(registry.get_all()).toEqual([]);
  });

  it('get_dangerous() returns tools with danger_level >= warning', () => {
    registry.register(makeTool('safe_tool', 'safe'));
    registry.register(makeTool('warning_tool', 'warning'));
    registry.register(makeTool('dangerous_tool', 'dangerous'));

    const dangerous = registry.get_dangerous();
    expect(dangerous.map((t) => t.name)).toContain('warning_tool');
    expect(dangerous.map((t) => t.name)).toContain('dangerous_tool');
    expect(dangerous.map((t) => t.name)).not.toContain('safe_tool');
  });

  it('get_dangerous() returns empty array when no dangerous tools', () => {
    registry.register(makeTool('only_safe', 'safe'));
    expect(registry.get_dangerous()).toEqual([]);
  });
});
