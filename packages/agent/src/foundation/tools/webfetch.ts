// T-13: WebFetch Tool - Fetch URL and convert to Markdown
import Turndown from 'turndown';
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';

// ============================================================
// Types
// ============================================================

interface WebFetchArgs {
  url: string;
  prompt?: string;
}

interface FetchResult {
  title: string;
  url: string;
  content: string;
  language: string;
}

// ============================================================
// Helpers
// ============================================================

const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_SIZE = 500 * 1024; // 500KB
const MAX_MARKDOWN_CHARS = 20_000;

/**
 * Simple language detection based on character frequency.
 */
function detect_language(text: string): string {
  const zh = /[\u4e00-\u9fff]/.test(text);
  if (zh) return 'zh';
  const ja = /[\u3040-\u30ff]/.test(text);
  if (ja) return 'ja';
  const ko = /[\uac00-\ud7af]/.test(text);
  if (ko) return 'ko';
  return 'en';
}

/**
 * Extract title from HTML string.
 */
function extract_title(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

/**
 * Strip ads, nav, footer, scripts, styles from HTML before conversion.
 */
function clean_html(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function truncate_markdown(markdown: string): string {
  if (markdown.length <= MAX_MARKDOWN_CHARS) {
    return markdown;
  }

  return `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n[Truncated: content too long, showing first ${MAX_MARKDOWN_CHARS} characters]`;
}

// ============================================================
// Handler
// ============================================================

async function webfetch_handler(
  args: Record<string, unknown>,
  _context: ToolContext,
): Promise<ToolResult> {
  const { url, prompt } = args as unknown as WebFetchArgs;

  // Validate URL
  if (!url || typeof url !== 'string') {
    return {
      tool_call_id: '',
      output: JSON.stringify({ error: 'url is required and must be a string' }),
      success: false,
    };
  }

  let parsed_url: URL;
  try {
    parsed_url = new URL(url);
  } catch {
    return {
      tool_call_id: '',
      output: JSON.stringify({ error: `Invalid URL: ${url}` }),
      success: false,
    };
  }

  if (!['http:', 'https:'].includes(parsed_url.protocol)) {
    return {
      tool_call_id: '',
      output: JSON.stringify({ error: `Unsupported protocol: ${parsed_url.protocol}` }),
      success: false,
    };
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Chromatopsia/1.0 (Agent WebFetch Tool)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return {
        tool_call_id: '',
        output: JSON.stringify({ error: `HTTP ${response.status}: ${response.statusText}` }),
        success: false,
      };
    }

    const content_length = response.headers.get('content-length');
    if (content_length && parseInt(content_length, 10) > MAX_HTML_SIZE) {
      return {
        tool_call_id: '',
        output: JSON.stringify({ error: `HTML response too large: ${content_length} bytes (max ${MAX_HTML_SIZE})` }),
        success: false,
      };
    }

    html = await response.text();

    if (html.length > MAX_HTML_SIZE) {
      html = html.slice(0, MAX_HTML_SIZE);
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return {
        tool_call_id: '',
        output: JSON.stringify({ error: `Timeout after ${FETCH_TIMEOUT_MS}ms` }),
        success: false,
      };
    }
    return {
      tool_call_id: '',
      output: JSON.stringify({ error: `Fetch failed: ${String(e)}` }),
      success: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  // Extract title before cleaning
  const title = extract_title(html);

  // Clean HTML and convert to Markdown
  const cleaned = clean_html(html);
  const turndown = new Turndown({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  let markdown: string;
  try {
    markdown = turndown.turndown(cleaned);
  } catch {
    // Fallback: return raw text
    markdown = cleaned.replace(/<[^>]+>/g, '').trim();
  }

  // Apply prompt hint if provided (just prepend context for LLM)
  if (prompt) {
    markdown = `【Prompt: ${prompt}】\n\n${markdown}`;
  }

  markdown = truncate_markdown(markdown);

  const result: FetchResult = {
    title,
    url,
    content: markdown,
    language: detect_language(markdown),
  };

  return {
    tool_call_id: '',
    output: JSON.stringify(result),
    success: true,
  };
}

// ============================================================
// Tool Definition
// ============================================================

export const webfetch_definition: ToolDefinition = {
  name: 'WebFetch',
  description:
    'Fetch and extract the main content from a URL. Use for reading documentation, blog posts, or any web page.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      prompt: {
        type: 'string',
        description: 'Specific question or extract hint for the LLM to focus on',
      },
    },
    required: ['url'],
  },
  danger_level: 'safe',
  handler: webfetch_handler,
};
