// T-11: Glob Tool tests
import { describe, it, expect } from 'vitest';
import { glob_definition } from '../../src/foundation/tools/glob.js';
import type { ToolContext } from '../../src/foundation/types.js';
import { writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';

describe('glob tool', () => {
  describe('glob_definition', () => {
    it('should have correct tool name', () => {
      expect(glob_definition.name).toBe('Glob');
    });

    it('should be marked as safe', () => {
      expect(glob_definition.danger_level).toBe('safe');
    });

    it('should have required pattern parameter', () => {
      const schema = glob_definition.input_schema as {
        properties: Record<string, { type: string; description?: string }>;
        required: string[];
      };
      expect(schema.properties.pattern).toBeDefined();
      expect(schema.required).toContain('pattern');
    });

    it('should have optional path parameter', () => {
      const schema = glob_definition.input_schema as {
        properties: Record<string, { type: string; description?: string }>;
      };
      expect(schema.properties.path).toBeDefined();
    });
  });

  describe('glob handler', () => {
    const mockContext: ToolContext = {
      session: {} as any,
      working_directory: process.cwd(),
    };

    it('should reject missing pattern', async () => {
      const result = await glob_definition.handler({} as any, mockContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain('pattern');
    });

    it('should reject sandbox escape via ../', async () => {
      const result = await glob_definition.handler(
        { pattern: '**/*', path: '../etc' } as any,
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain('Sandbox violation');
    });

    it('should find files matching * pattern in current dir', async () => {
      const tmpDir = path.join(process.cwd(), '.test_glob_tmp');
      await mkdir(tmpDir, { recursive: true });
      await writeFile(path.join(tmpDir, 'file1.txt'), '');
      await writeFile(path.join(tmpDir, 'file2.txt'), '');

      const result = await glob_definition.handler(
        { pattern: '*.txt', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.txt');
      expect(result.output).toContain('file2.txt');

      await unlink(path.join(tmpDir, 'file1.txt'));
      await unlink(path.join(tmpDir, 'file2.txt'));
      await rmdir(tmpDir);
    });

    it('should find files matching **/* pattern recursively', async () => {
      const tmpDir = path.join(process.cwd(), '.test_glob_recursive_tmp');
      const subDir = path.join(tmpDir, 'sub');
      await mkdir(subDir, { recursive: true });
      await writeFile(path.join(tmpDir, 'root.ts'), '');
      await writeFile(path.join(subDir, 'nested.ts'), '');

      const result = await glob_definition.handler(
        { pattern: '**/*.ts', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('root.ts');
      expect(result.output).toContain('nested.ts');

      await unlink(path.join(tmpDir, 'root.ts'));
      await unlink(path.join(subDir, 'nested.ts'));
      await rmdir(subDir);
      await rmdir(tmpDir);
    });

    it('should return empty for no matches', async () => {
      const tmpDir = path.join(process.cwd(), '.test_glob_empty_tmp');
      await mkdir(tmpDir, { recursive: true });

      const result = await glob_definition.handler(
        { pattern: '*.nonexistent', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('');

      await rmdir(tmpDir);
    });

    it('should filter by file type', async () => {
      const tmpDir = path.join(process.cwd(), '.test_glob_filter_tmp');
      await mkdir(tmpDir, { recursive: true });
      await writeFile(path.join(tmpDir, 'file.ts'), '');
      await writeFile(path.join(tmpDir, 'file.txt'), '');

      const result = await glob_definition.handler(
        { pattern: '*.ts', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('file.ts');
      expect(result.output).not.toContain('file.txt');

      await unlink(path.join(tmpDir, 'file.ts'));
      await unlink(path.join(tmpDir, 'file.txt'));
      await rmdir(tmpDir);
    });

    it('should use working_directory as default path', async () => {
      const cwd = process.cwd();
      const result = await glob_definition.handler(
        { pattern: '*.ts' },
        { session: {} as any, working_directory: cwd },
      );

      expect(result.success).toBe(true);
      // Should find some .ts files in the cwd
      expect(result.output).toBeDefined();
    });

    it('should find all files with *', async () => {
      const tmpDir = path.join(process.cwd(), '.test_glob_all_tmp');
      await mkdir(tmpDir, { recursive: true });
      await writeFile(path.join(tmpDir, 'file1.txt'), '');
      await writeFile(path.join(tmpDir, 'file2.md'), '');

      const result = await glob_definition.handler(
        { pattern: '*', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.txt');
      expect(result.output).toContain('file2.md');

      await unlink(path.join(tmpDir, 'file1.txt'));
      await unlink(path.join(tmpDir, 'file2.md'));
      await rmdir(tmpDir);
    });

    it('should skip common heavy directories during recursive search', async () => {
      const tmpDir = path.join(process.cwd(), '.test_glob_ignore_tmp');
      const nodeModulesDir = path.join(tmpDir, 'node_modules');
      const srcDir = path.join(tmpDir, 'src');
      await mkdir(nodeModulesDir, { recursive: true });
      await mkdir(srcDir, { recursive: true });
      await writeFile(path.join(nodeModulesDir, 'package.json'), '{}');
      await writeFile(path.join(srcDir, 'package.json'), '{}');

      const result = await glob_definition.handler(
        { pattern: '**/package.json', path: tmpDir },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain(path.join('src', 'package.json'));
      expect(result.output).not.toContain(path.join('node_modules', 'package.json'));

      await unlink(path.join(nodeModulesDir, 'package.json'));
      await unlink(path.join(srcDir, 'package.json'));
      await rmdir(nodeModulesDir);
      await rmdir(srcDir);
      await rmdir(tmpDir);
    });
  });
});
