// T-10: Edit Tool tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { edit_definition } from '../../src/foundation/tools/edit.js';
import type { ToolContext } from '../../src/foundation/types.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('edit tool', () => {
  describe('edit_definition', () => {
    it('should have correct tool name', () => {
      expect(edit_definition.name).toBe('Edit');
    });

    it('should be marked as warning level', () => {
      expect(edit_definition.danger_level).toBe('warning');
    });

    it('should have required parameters', () => {
      const schema = edit_definition.input_schema as {
        properties: Record<string, { type: string }>;
        required: string[];
      };
      expect(schema.properties.file_path).toBeDefined();
      expect(schema.properties.old_string).toBeDefined();
      expect(schema.properties.new_string).toBeDefined();
      expect(schema.required).toContain('file_path');
      expect(schema.required).toContain('old_string');
      expect(schema.required).toContain('new_string');
    });
  });

  describe('edit_handler', () => {
    const tmpDir = join(tmpdir(), 'chromatopsia-edit-test-' + Date.now());
    const mockContext: ToolContext = {
      session: {} as any,
      working_directory: tmpDir,
    };

    beforeEach(async () => {
      await mkdir(tmpDir, { recursive: true });
    });

    afterEach(async () => {
      // Cleanup is handled by OS in tmpdir
    });

    it('should replace old_string with new_string', async () => {
      const filePath = join(tmpDir, 'test1.txt');
      await writeFile(filePath, 'hello world', 'utf-8');

      const result = await edit_definition.handler(
        { file_path: filePath, old_string: 'world', new_string: 'chromatopsia' },
        mockContext,
      );

      expect(result.success).toBe(true);
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('hello chromatopsia');
    });

    it('should fail when old_string not found', async () => {
      const filePath = join(tmpDir, 'test2.txt');
      await writeFile(filePath, 'hello world', 'utf-8');

      const result = await edit_definition.handler(
        { file_path: filePath, old_string: 'notfound', new_string: 'x' },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain('old_string not found');
    });

    it('should fail when file does not exist', async () => {
      const result = await edit_definition.handler(
        { file_path: join(tmpDir, 'nonexistent.txt'), old_string: 'a', new_string: 'b' },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain('file not found');
    });

    it('should reject sandbox violation (path outside working_directory)', async () => {
      const result = await edit_definition.handler(
        { file_path: '/etc/passwd', old_string: 'a', new_string: 'b' },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain('Sandbox violation');
    });

    it('should reject empty file_path', async () => {
      const result = await edit_definition.handler(
        { file_path: '', old_string: 'a', new_string: 'b' },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain('file_path is required');
    });

    it('should replace only the first occurrence when old_string appears multiple times', async () => {
      const filePath = join(tmpDir, 'test3.txt');
      await writeFile(filePath, 'foo bar foo', 'utf-8');

      const result = await edit_definition.handler(
        { file_path: filePath, old_string: 'foo', new_string: 'baz' },
        mockContext,
      );

      expect(result.success).toBe(true);
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('baz bar foo'); // only first foo replaced
    });
  });
});
