// T-09: Read Tool tests
import { describe, it, expect, beforeEach } from 'vitest';
import { read_definition } from '../../src/foundation/tools/read.js';
import { resolve_path } from '../../src/foundation/tools/executor.js';
import type { ToolContext } from '../../src/foundation/types.js';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';

describe('read tool', () => {
  describe('resolve_path', () => {
    const cwd = process.cwd();

    it('should allow relative paths within cwd', () => {
      const relative = path.relative(cwd, import.meta.filename);
      const result = resolve_path(relative, cwd);
      expect(result).toBe(path.normalize(import.meta.filename));
    });

    it('should reject paths outside cwd', () => {
      expect(() => resolve_path('..', cwd)).toThrow('Sandbox violation');
    });

    it('should reject absolute paths outside cwd', () => {
      expect(() => resolve_path('/etc/passwd', cwd)).toThrow('Sandbox violation');
    });

    it('should handle same directory as cwd', () => {
      const result = resolve_path(cwd, cwd);
      expect(result).toBe(path.normalize(cwd));
    });
  });

  describe('read_definition', () => {
    it('should have correct tool name', () => {
      expect(read_definition.name).toBe('Read');
    });

    it('should be marked as safe', () => {
      expect(read_definition.danger_level).toBe('safe');
    });

    it('should have required file_path parameter', () => {
      const schema = read_definition.input_schema as {
        properties: Record<string, { type: string; description?: string }>;
        required: string[];
      };
      expect(schema.properties.file_path).toBeDefined();
      expect(schema.required).toContain('file_path');
    });

    it('should have optional offset and limit parameters', () => {
      const schema = read_definition.input_schema as {
        properties: Record<string, { type: string; description?: string }>;
      };
      expect(schema.properties.offset).toBeDefined();
      expect(schema.properties.limit).toBeDefined();
    });
  });

  describe('read handler', () => {
    const mockContext: ToolContext = {
      session: {} as any,
      working_directory: process.cwd(),
    };

    it('should reject missing file_path', async () => {
      const result = await read_definition.handler({}, mockContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain('required');
    });

    it('should reject non-string file_path', async () => {
      const result = await read_definition.handler(
        { file_path: 123 } as any,
        mockContext,
      );
      expect(result.success).toBe(false);
    });

    it('should read a file successfully', async () => {
      const tmpDir = process.cwd();
      const testFile = path.join(tmpDir, '.test_read_tmp.txt');
      await writeFile(testFile, 'line1\nline2\nline3\n');

      const result = await read_definition.handler(
        { file_path: '.test_read_tmp.txt' },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('1 | line1');
      expect(result.output).toContain('3 | line3');

      await unlink(testFile);
    });

    it('should apply offset correctly', async () => {
      const tmpDir = process.cwd();
      const testFile = path.join(tmpDir, '.test_read_offset_tmp.txt');
      await writeFile(testFile, 'line1\nline2\nline3\nline4\nline5\n');

      const result = await read_definition.handler(
        { file_path: '.test_read_offset_tmp.txt', offset: 1, limit: 2 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('2 | line2');
      expect(result.output).toContain('3 | line3');
      expect(result.output).not.toContain('line1');
      expect(result.output).not.toContain('line4');

      await unlink(testFile);
    });

    it('should return empty output when offset exceeds file length', async () => {
      const tmpDir = process.cwd();
      const testFile = path.join(tmpDir, '.test_read_empty_tmp.txt');
      await writeFile(testFile, 'line1\n');

      const result = await read_definition.handler(
        { file_path: '.test_read_empty_tmp.txt', offset: 100 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('');

      await unlink(testFile);
    });

    it('should reject nonexistent files', async () => {
      const result = await read_definition.handler(
        { file_path: 'nonexistent/subdir/file.txt' },
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('not found');
    });

    it('should reject sandbox escape via ../', async () => {
      const result = await read_definition.handler(
        { file_path: '../etc/passwd' },
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('Sandbox violation');
    });

    it('should respect limit default of 500', async () => {
      const tmpDir = process.cwd();
      const testFile = path.join(tmpDir, '.test_read_limit_tmp.txt');
      const manyLines = Array.from({ length: 600 }, (_, i) => `line${i + 1}`).join('\n');
      await writeFile(testFile, manyLines);

      const result = await read_definition.handler(
        { file_path: '.test_read_limit_tmp.txt' },
        mockContext,
      );

      expect(result.success).toBe(true);
      // Should have 500 lines (the default limit)
      const outputLines = result.output.split('\n');
      expect(outputLines.length).toBeLessThanOrEqual(500);

      await unlink(testFile);
    });
  });
});
