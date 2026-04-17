import { Box, Text } from 'ink';
import hljs from 'highlight.js';
import { marked } from 'marked';
import { TUI_THEME } from '../types.js';

type MarkdownProps = {
  text: string;
};

type MarkdownSpan =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'emphasis'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href?: string };

type CodeSegment = {
  text: string;
  color?: string;
};

type MarkdownBlock =
  | { kind: 'heading'; depth: number; spans: MarkdownSpan[] }
  | { kind: 'paragraph'; spans: MarkdownSpan[] }
  | { kind: 'list'; ordered: boolean; items: Array<{ marker: string; spans: MarkdownSpan[] }> }
  | { kind: 'blockquote'; lines: MarkdownSpan[][] }
  | { kind: 'code'; lang?: string; lines: string[] }
  | { kind: 'rule' };

type TokenLike = {
  type: string;
  text?: string;
  depth?: number;
  lang?: string;
  href?: string;
  ordered?: boolean;
  start?: number;
  tokens?: TokenLike[];
  items?: TokenLike[];
};

const HLJS_CLASS_COLOR_MAP: Array<[pattern: RegExp, color: string]> = [
  [/hljs-(keyword|operator|selector-tag|selector-pseudo|template-tag|name)/, TUI_THEME.syntaxKeyword],
  [/hljs-(string|regexp|char|subst)/, TUI_THEME.syntaxString],
  [/hljs-(number|symbol|bullet)/, TUI_THEME.syntaxNumber],
  [/hljs-(title|section|attr|attribute|property|variable|params)/, TUI_THEME.syntaxTitle],
  [/hljs-(literal|built_in|type)/, TUI_THEME.syntaxLiteral],
  [/hljs-(comment|quote)/, TUI_THEME.syntaxComment],
];

export function parseMarkdown(text: string): MarkdownBlock[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const tokens = marked.lexer(normalized, {
    gfm: true,
    breaks: true,
  }) as TokenLike[];

  return tokens.flatMap((token) => mapBlockToken(token));
}

function mapBlockToken(token: TokenLike): MarkdownBlock[] {
  switch (token.type) {
    case 'heading':
      return [{ kind: 'heading', depth: token.depth ?? 1, spans: inlineTokensToSpans(token.tokens, token.text) }];
    case 'paragraph':
    case 'text':
      return [{ kind: 'paragraph', spans: inlineTokensToSpans(token.tokens, token.text) }];
    case 'list':
      return [{
        kind: 'list',
        ordered: Boolean(token.ordered),
        items: (token.items ?? []).map((item, index) => ({
          marker: token.ordered ? `${(token.start ?? 1) + index}.` : '\u2022',
          spans: item.tokens ? inlineTokensToSpans(flattenInlineTokens(item.tokens)) : inlineTokensToSpans(undefined, item.text),
        })),
      }];
    case 'blockquote':
      return [{
        kind: 'blockquote',
        lines: (token.tokens ?? [])
          .flatMap((inner) => mapBlockToken(inner))
          .flatMap((block) => blockToQuoteLines(block)),
      }];
    case 'code':
      return [{ kind: 'code', lang: token.lang, lines: (token.text ?? '').split('\n') }];
    case 'hr':
      return [{ kind: 'rule' }];
    case 'space':
      return [];
    default:
      return token.text ? [{ kind: 'paragraph', spans: [{ kind: 'text', text: token.text }] }] : [];
  }
}

function blockToQuoteLines(block: MarkdownBlock): MarkdownSpan[][] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return [block.spans];
    case 'list':
      return block.items.map((item) => [{ kind: 'text', text: `${item.marker} ` }, ...item.spans]);
    case 'code':
      return block.lines.map((line) => [{ kind: 'code', text: line }]);
    case 'rule':
      return [[{ kind: 'text', text: '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' }]];
    default:
      return [];
  }
}

function flattenInlineTokens(tokens: TokenLike[]): TokenLike[] {
  return tokens.flatMap((token) => {
    if (token.type === 'paragraph' || token.type === 'text') {
      return token.tokens ?? [{ type: 'text', text: token.text ?? '' }];
    }
    return [token];
  });
}

function inlineTokensToSpans(tokens?: TokenLike[], fallbackText?: string): MarkdownSpan[] {
  if (!tokens || tokens.length === 0) {
    return fallbackText ? [{ kind: 'text', text: fallbackText }] : [];
  }

  return tokens.flatMap((token) => {
    switch (token.type) {
      case 'text':
        if (token.tokens && token.tokens.length > 0) {
          return inlineTokensToSpans(token.tokens, token.text);
        }
        return token.text ? [{ kind: 'text', text: token.text }] : [];
      case 'strong':
        return [{ kind: 'strong', text: extractInlineText(token.tokens, token.text) }];
      case 'em':
        return [{ kind: 'emphasis', text: extractInlineText(token.tokens, token.text) }];
      case 'codespan':
        return [{ kind: 'code', text: token.text ?? '' }];
      case 'link':
        return [{ kind: 'link', text: extractInlineText(token.tokens, token.text), href: token.href }];
      case 'br':
        return [{ kind: 'text', text: '\n' }];
      case 'del':
      case 'escape':
      case 'html':
      default:
        return token.text ? [{ kind: 'text', text: token.text }] : [];
    }
  });
}

function extractInlineText(tokens?: TokenLike[], fallbackText?: string): string {
  if (!tokens || tokens.length === 0) {
    return fallbackText ?? '';
  }

  return tokens.map((token) => {
    if (token.text) return token.text;
    if (token.tokens) return extractInlineText(token.tokens, token.text);
    return '';
  }).join('');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function colorForHighlightClasses(classes: string[]): string | undefined {
  const joined = classes.join(' ');
  for (const [pattern, color] of HLJS_CLASS_COLOR_MAP) {
    if (pattern.test(joined)) return color;
  }
  return undefined;
}

function tokenizeHighlightedHtml(value: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  const stack: string[] = [];
  const tagPattern = /<span class="([^"]*)">|<\/span>/g;
  let lastIndex = 0;

  for (const match of value.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      const text = decodeHtmlEntities(value.slice(lastIndex, index));
      if (text) segments.push({ text, color: colorForHighlightClasses(stack) });
    }

    if (match[0] === '</span>') {
      stack.pop();
    } else {
      stack.push(match[1] ?? '');
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < value.length) {
    const text = decodeHtmlEntities(value.slice(lastIndex));
    if (text) segments.push({ text, color: colorForHighlightClasses(stack) });
  }

  return segments;
}

export function highlightCodeLine(line: string, lang?: string): CodeSegment[] {
  if (!line) return [{ text: ' ' }];

  try {
    const result = lang && hljs.getLanguage(lang)
      ? hljs.highlight(line, { language: lang, ignoreIllegals: true })
      : hljs.highlightAuto(line);
    const segments = tokenizeHighlightedHtml(result.value);
    return segments.length > 0 ? segments : [{ text: line }];
  } catch {
    return [{ text: line }];
  }
}

function renderSpans(spans: MarkdownSpan[]) {
  return spans.map((span, index) => {
    switch (span.kind) {
      case 'strong':
        return (
          <Text key={index} bold color={TUI_THEME.highlightedText}>
            {span.text}
          </Text>
        );
      case 'emphasis':
        return (
          <Text key={index} italic color={TUI_THEME.textMuted}>
            {span.text}
          </Text>
        );
      case 'code':
        return (
          <Text key={index} color={TUI_THEME.highlightedText}>
            {` ${span.text} `}
          </Text>
        );
      case 'link':
        return (
          <Text key={index} underline color={TUI_THEME.info}>
            {span.text || span.href || ''}
          </Text>
        );
      case 'text':
      default:
        return <Text key={index}>{span.text}</Text>;
    }
  });
}

function renderBlock(block: MarkdownBlock, index: number) {
  switch (block.kind) {
    case 'heading':
      return (
        <Text key={index} bold color={TUI_THEME.primary}>
          {renderSpans(block.spans)}
        </Text>
      );
    case 'paragraph':
      return (
        <Text key={index} color={TUI_THEME.textPrimary}>
          {renderSpans(block.spans)}
        </Text>
      );
    case 'list':
      return (
        <Box key={index} flexDirection="column">
          {block.items.map((item, itemIndex) => (
            <Box key={`${index}-${itemIndex}`}>
              <Text color={TUI_THEME.primary}>{`${item.marker} `}</Text>
              <Text color={TUI_THEME.textPrimary}>{renderSpans(item.spans)}</Text>
            </Box>
          ))}
        </Box>
      );
    case 'blockquote':
      return (
        <Box key={index} flexDirection="column" marginLeft={1}>
          {block.lines.map((line, lineIndex) => (
            <Box key={`${index}-${lineIndex}`}>
              <Text color={TUI_THEME.textDim}>{'\u2502 '}</Text>
              <Text color={TUI_THEME.textMuted}>{renderSpans(line)}</Text>
            </Box>
          ))}
        </Box>
      );
    case 'code':
      return (
        <Box key={index} flexDirection="column" marginLeft={1}>
          <Text color={TUI_THEME.textDim}>{`[${block.lang || 'text'}]`}</Text>
          {block.lines.map((line, lineIndex) => (
            <Text key={`${index}-${lineIndex}`} color={TUI_THEME.textPrimary}>
              {highlightCodeLine(line, block.lang).map((segment, segmentIndex) => (
                <Text key={`${index}-${lineIndex}-${segmentIndex}`} color={segment.color ?? TUI_THEME.textPrimary}>
                  {segment.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      );
    case 'rule':
      return (
        <Text key={index} color={TUI_THEME.textDim}>
          {'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}
        </Text>
      );
  }
}

export function Markdown({ text }: MarkdownProps) {
  const blocks = parseMarkdown(text);

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => renderBlock(block, index))}
    </Box>
  );
}
