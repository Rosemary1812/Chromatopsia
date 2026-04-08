// T-11: Grep Tool tests
import { describe, it, expect } from 'vitest';
import { grep_definition } from '../../src/tools/grep.js';
import type { ToolContext } from '../../src/types.js';
import { writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';

describe('grep tool', () => {
  describe('grep_definition', () => {
    it('should have correct tool name', () => {
      expect(grep_definition.name).toBe('Grep');
    });

    it('should be marked as safe', () => {
      expect(grep_definition.danger_level).toBe('safe');
    });

    it('should have required pattern and path parameters', () => {
      const schema = grep_definition.input_schema as {
        properties: Record<string, { type: string; description?: string }>;
        required: string[];
      };
      expect(schema.properties.pattern).toBeDefined();
      expect(schema.properties.path).toBeDefined();
      expect(schema.required).toContain('pattern');
      expect(schema.required).toContain('path');
    });

    it('should have optional glob and context parameters', () => {
      const schema = grep_definition.input_schema as {
        properties: Record<string, { type: string; description?: string }>;
      };
      expect(schema.properties.glob).toBeDefined();
      expect(schema.properties.context).toBeDefined();
    });
  });

  describe('grep handler', () => {
    const mockContext: ToolContext = {
      session: {} as any,
      working_directory: process.cwd(),
    };

    it('should reject missing pattern', async () => {
      const result = await grep_definition.handler({ path: '.' } as any, mockContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain('pattern');
    });

    it('should reject missing path', async () => {
      const result = await grep_definition.handler({ pattern: 'test' } as any, mockContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain('path');
    });

    it('should reject invalid regex', async () => {
      const result = await grep_definition.handler(
        { pattern: '[invalid', path: '.' } as any,
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('invalid regex');
    });

    it('should reject sandbox escape via ../', async () => {
      const result = await grep_definition.handler(
        { pattern: 'test', path: '../etc/passwd' } as any,
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('Sandbox violation');
    });

    it('should find pattern in file', async () => {
      const tmpDir = path.join(process.cwd(), '.test_grep_tmp');
      await mkdir(tmpDir, { recursive: true });
      const testFile = path.join(tmpDir, 'test.txt');
      await writeFile(testFile, 'function foo() {}\nfunction bar() {}\n// comment\n');

      const result = await grep_definition.handler(
        { pattern: 'function', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('function foo');
      expect(result.output).toContain('function bar');

      await unlink(testFile);
      await rmdir(tmpDir);
    });

    it('should return empty for no matches', async () => {
      const tmpDir = path.join(process.cwd(), '.test_grep_empty_tmp');
      await mkdir(tmpDir, { recursive: true });
      const testFile = path.join(tmpDir, 'test.txt');
      await writeFile(testFile, 'hello world\n');

      const result = await grep_definition.handler(
        { pattern: 'nonexistent', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('');

      await unlink(testFile);
      await rmdir(tmpDir);
    });

    it('should filter by glob pattern', async () => {
      const tmpDir = path.join(process.cwd(), '.test_grep_glob_tmp');
      await mkdir(tmpDir, { recursive: true });
      const tsFile = path.join(tmpDir, 'test.ts');
      const txtFile = path.join(tmpDir, 'test.txt');
      await writeFile(tsFile, 'function typescript() {}\n');
      await writeFile(txtFile, 'function textfile() {}\n');

      const result = await grep_definition.handler(
        { pattern: 'function', path: tmpDir, glob: '*.ts' },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('typescript');
      expect(result.output).not.toContain('textfile');

      await unlink(tsFile);
      await unlink(txtFile);
      await rmdir(tmpDir);
    });

    it('should show context lines', async () => {
      const tmpDir = path.join(process.cwd(), '.test_grep_ctx_tmp');
      await mkdir(tmpDir, { recursive: true });
      const testFile = path.join(tmpDir, 'test.txt');
      await writeFile(testFile, 'line1\nline2\nline3\nline4\nline5\n');

      const result = await grep_definition.handler(
        { pattern: 'line3', path: tmpDir, context: 1 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('line2');
      expect(result.output).toContain('line3');
      expect(result.output).toContain('line4');

      await unlink(testFile);
      await rmdir(tmpDir);
    });

    it('should search recursively in subdirectories', async () => {
      const tmpDir = path.join(process.cwd(), '.test_grep_recursive_tmp');
      const subDir = path.join(tmpDir, 'sub');
      await mkdir(subDir, { recursive: true });
      const file1 = path.join(tmpDir, 'file1.txt');
      const file2 = path.join(subDir, 'file2.txt');
      await writeFile(file1, 'hello\n');
      await writeFile(file2, 'world\nhello\n');

      const result = await grep_definition.handler(
        { pattern: 'hello', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('hello');

      await unlink(file1);
      await unlink(file2);
      await rmdir(subDir);
      await rmdir(tmpDir);
    });
  });
});
