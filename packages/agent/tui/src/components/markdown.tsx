import { Box, Text } from 'ink';
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

export function parseMarkdown(text: string): MarkdownBlock[] {
  // 先把 Markdown 解析成稳定的中间结构，再做 Ink 渲染。
  // 这样测试可以直接验证解析结果，不必依赖终端渲染细节。
  const normalized = text.replace(/\r\n/g, '\n');
  const tokens = marked.lexer(normalized, {
    gfm: true,
    breaks: true,
  }) as TokenLike[];

  return tokens.flatMap((token) => mapBlockToken(token));
}

function mapBlockToken(token: TokenLike): MarkdownBlock[] {
  // 这里只保留当前 TUI 真正需要的 block 类型，避免复杂 Markdown 破坏布局。
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
          marker: token.ordered ? `${(token.start ?? 1) + index}.` : '•',
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
      return [[{ kind: 'text', text: '────────' }]];
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

  // inline 层只抽 strong / emphasis / code / link，其他复杂语义退回纯文本。
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
          <Text key={index} color={TUI_THEME.highlightedText} backgroundColor={TUI_THEME.secondaryBackground}>
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
  // Ink 负责终端中的视觉层级：标题、列表、引用、代码块各自有独立的排版。
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
              <Text color={TUI_THEME.textDim}>{'│ '}</Text>
              <Text color={TUI_THEME.textMuted}>{renderSpans(line)}</Text>
            </Box>
          ))}
        </Box>
      );
    case 'code':
      return (
        <Box key={index} flexDirection="column" marginLeft={1}>
          <Text color={TUI_THEME.textDim}>{`┌─ ${block.lang || 'text'}`}</Text>
          {block.lines.map((line, lineIndex) => (
            <Text key={`${index}-${lineIndex}`} color={TUI_THEME.textPrimary}>
              {line || ' '}
            </Text>
          ))}
        </Box>
      );
    case 'rule':
      return (
        <Text key={index} color={TUI_THEME.textDim}>
          {'────────────────'}
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
