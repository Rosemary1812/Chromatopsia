// T-12: WebSearch Tool tests
import { describe, it, expect } from 'vitest';
import { websearch_definition } from '../../src/foundation/tools/websearch.js';
import type { ToolContext } from '../../src/foundation/types.js';

describe('websearch tool', () => {
  const mockContext: ToolContext = {
    session: {} as any,
    working_directory: '/project',
  };

  describe('websearch_definition', () => {
    it('should have correct tool name', () => {
      expect(websearch_definition.name).toBe('WebSearch');
    });

    it('should be marked as safe', () => {
      expect(websearch_definition.danger_level).toBe('safe');
    });

    it('should have required query parameter', () => {
      const schema = websearch_definition.input_schema as {
        properties: Record<string, { type: string; description?: string }>;
        required: string[];
      };
      expect(schema.properties.query).toBeDefined();
      expect(schema.required).toContain('query');
    });

    it('should have optional num_results parameter', () => {
      const schema = websearch_definition.input_schema as {
        properties: Record<string, { type: string; description?: string }>;
      };
      expect(schema.properties.num_results).toBeDefined();
    });
  });

  describe('websearch handler', () => {
    it('should reject empty query', async () => {
      const result = await websearch_definition.handler({}, mockContext);
      expect(result.success).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed.error).toContain('required');
    });

    it('should reject whitespace-only query', async () => {
      const result = await websearch_definition.handler(
        { query: '   ' } as any,
        mockContext,
      );
      expect(result.success).toBe(false);
    });

    it('should reject non-string query', async () => {
      const result = await websearch_definition.handler(
        { query: 123 } as any,
        mockContext,
      );
      expect(result.success).toBe(false);
    });

    // Note: Actual search functionality requires network access.
    // Validation-only tests are sufficient for unit test coverage.
  });
});
