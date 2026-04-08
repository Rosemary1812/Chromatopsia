// T-12: WebSearch Tool - DuckDuckGo search
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';

// ============================================================
// Search Result Types
// ============================================================

export type SearchSource = 'duckduckgo' | 'bing';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: SearchSource;
}

export interface SearchResponse {
  results: SearchResult[];
}

// ============================================================
// DuckDuckGo HTML Parsing
// ============================================================

/**
 * Fetch DuckDuckGo search results using the HTML beta endpoint.
 * Falls back to lite if needed.
 */
async function duckduckgo_search(
  query: string,
  numResults: number = 5,
): Promise<SearchResponse> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}&kl=wt-wt`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Chromatopsia/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    clearTimeout(timeout);

    return parse_ddg_html(html, numResults);
  } catch (e) {
    clearTimeout(timeout);
    if ((e as Error).name === 'AbortError') {
      throw new Error('Search request timed out (15s)');
    }
    throw e;
  }
}

/**
 * Parse DuckDuckGo HTML results into structured SearchResult[].
 */
function parse_ddg_html(html: string, numResults: number): SearchResponse {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML result blocks
  // Each result is in a <a> tag with class "result__a"
  const anchorRegex = /<a class="result__a" href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  // Snippet is in <a> class="result__snippet"
  const snippetRegex = /<a class="result__snippet"[^>]*>(.*?)<\/a>/gi;

  const anchorMatches = [...html.matchAll(anchorRegex)];
  const snippetMatches = [...html.matchAll(snippetRegex)];

  const count = Math.min(anchorMatches.length, numResults);

  for (let i = 0; i < count; i++) {
    const url = anchorMatches[i]?.[1] ?? '';
    const rawTitle = anchorMatches[i]?.[2] ?? '';
    const title = strip_html(rawTitle);

    const rawSnippet = snippetMatches[i]?.[1] ?? '';
    const snippet = strip_html(rawSnippet);

    if (url && title) {
      results.push({
        title,
        url,
        snippet,
        source: 'duckduckgo',
      });
    }
  }

  return { results };
}

/**
 * Strip HTML tags from a string.
 */
function strip_html(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ============================================================
// Bing Search (fallback)
// ============================================================

/**
 * Fetch Bing search results as fallback.
 */
async function bing_search(
  query: string,
  numResults: number = 5,
): Promise<SearchResponse> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://cn.bing.com/search?q=${encodedQuery}&count=${numResults}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Chromatopsia/1.0)',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    clearTimeout(timeout);

    return parse_bing_html(html, numResults);
  } catch (e) {
    clearTimeout(timeout);
    if ((e as Error).name === 'AbortError') {
      throw new Error('Search request timed out (15s)');
    }
    throw e;
  }
}

/**
 * Parse Bing HTML results into structured SearchResult[].
 */
function parse_bing_html(html: string, numResults: number): SearchResponse {
  const results: SearchResult[] = [];

  // Split by result blocks
  const algoBlocks = html.split(/<li class="b_algo"/);

  for (let i = 1; i < algoBlocks.length && results.length < numResults; i++) {
    const block = algoBlocks[i];

    // Extract URL and title from <h2> block
    const h2Match = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!h2Match) continue;

    const h2Content = h2Match[1];
    const linkMatch = h2Content.match(/href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const rawTitle = linkMatch[2];
    const title = strip_html(rawTitle);

    // Extract snippet from <p class="b_lineclamp...">
    const snippetMatch = block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const rawSnippet = snippetMatch?.[1] ?? '';
    const snippet = strip_html(rawSnippet);

    if (url && title) {
      results.push({
        title,
        url,
        snippet,
        source: 'bing',
      });
    }
  }

  return { results };
}

// ============================================================
// Handler
// ============================================================

interface WebSearchArgs {
  query: string;
  num_results?: number;
}

async function websearch_handler(
  args: Record<string, unknown>,
  _context: ToolContext,
): Promise<ToolResult> {
  const { query, num_results = 5 } = args as unknown as WebSearchArgs;

  // Validate query
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return {
      tool_call_id: '',
      output: JSON.stringify({ error: 'Query is required and must be a non-empty string' }),
      success: false,
    };
  }

  const resultsCount = Math.min(Math.max(1, num_results ?? 5), 10);

  try {
    const response = await duckduckgo_search(query.trim(), resultsCount);

    return {
      tool_call_id: '',
      output: JSON.stringify(response),
      success: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Network error: try Bing as fallback
    if (
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('timed out')
    ) {
      try {
        const fallback = await bing_search(query.trim(), resultsCount);
        return {
          tool_call_id: '',
          output: JSON.stringify(fallback),
          success: true,
        };
      } catch {
        // Bing also failed
        return {
          tool_call_id: '',
          output: JSON.stringify({
            error: `Search service unavailable (DuckDuckGo and Bing both failed). ${msg}`,
          }),
          success: false,
        };
      }
    }

    return {
      tool_call_id: '',
      output: JSON.stringify({ error: `Search failed: ${msg}` }),
      success: false,
    };
  }
}

// ============================================================
// Tool Definition
// ============================================================

export const websearch_definition: ToolDefinition = {
  name: 'WebSearch',
  description:
    'Search the web for information. Use when you need up-to-date facts, documentation, or anything not in the codebase.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 10)',
      },
    },
    required: ['query'],
  },
  danger_level: 'safe',
  handler: websearch_handler,
};
