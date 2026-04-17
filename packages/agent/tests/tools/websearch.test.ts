// T-12: WebSearch Tool tests
import { describe, it, expect, vi, afterEach } from 'vitest';
import { websearch_definition } from '../../src/foundation/tools/websearch.js';
import type { ToolContext } from '../../src/foundation/types.js';

describe('websearch tool', () => {
  const mockContext: ToolContext = {
    session: {} as any,
    working_directory: '/project',
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    it('falls back to Bing when DuckDuckGo returns zero parsed results', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '<html><body><div>No parseable ddg results</div></body></html>',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `
            <html><body>
              <li class="b_algo">
                <h2><a href="https://example.com/ai-infra">AI Infrastructure Guide</a></h2>
                <p class="b_lineclamp">Overview of AI infrastructure components.</p>
              </li>
            </body></html>
          `,
        } as Response);

      const result = await websearch_definition.handler(
        { query: 'AI infrastructure', num_results: 5 },
        mockContext,
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].source).toBe('bing');
    });

    it('fails when both DuckDuckGo and Bing return zero results', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '<html><body><div>No parseable ddg results</div></body></html>',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '<html><body><div>No parseable bing results</div></body></html>',
        } as Response);

      const result = await websearch_definition.handler(
        { query: 'AI infrastructure', num_results: 5 },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain('no results');
    });
  });
});
