// ============================================================
// Session Summarizer — 自动压缩长对话上下文
// T-16
// ============================================================

import type { Message, LLMProvider, CompressionConfig, CompressionMetadata } from '../foundation/types.js';

// 默认配置
export const DEFAULT_COMPRESSION_CONFIG: Required<CompressionConfig> = {
  compress_threshold: 4500,
  preserve_recent: 4,
  min_summarizable: 6,
};

/**
 * 将消息列表格式化为摘要 prompt 的输入
 */
function format_messages_for_summary(messages: Message[]): string {
  return messages
    .map((msg, i) => {
      const role = msg.role.padEnd(10, ' ');
      const content = msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content;
      return `[${i + 1}] ${role} | ${content}`;
    })
    .join('\n');
}

/**
 * 构建摘要生成 prompt
 */
export function build_summarize_prompt(messages_to_compress: Message[]): string {
  return `请将以下对话历史压缩为一段简洁的摘要。

要求：
1. 保留关键决策、已完成的工作、当前任务状态
2. 忽略无关的试错过程
3. 用中文输出，200 字以内
4. 摘要需要让后续 Agent 能接续当前工作

对话历史：
${format_messages_for_summary(messages_to_compress)}

摘要：`;
}

/**
 * 检查是否需要压缩（按消息数量估算）
 */
export function needs_compression(
  messages: Message[],
  config: CompressionConfig,
): boolean {
  // 简单按消息数量粗估：平均每条消息约 200 tokens
  // 保守估算，实际按具体 token 数会更准确
  const estimated_tokens = messages.length * 200;
  return estimated_tokens >= config.compress_threshold;
}

/**
 * 核心压缩函数
 *
 * @param messages 当前消息列表
 * @param config 压缩配置
 * @param provider LLM Provider（用于生成摘要）
 * @returns 压缩后的消息列表 + 元数据
 */
export async function compress_session(
  messages: Message[],
  config: CompressionConfig,
  provider: LLMProvider,
): Promise<{ compressed: Message[]; metadata: CompressionMetadata }> {
  const resolved_config: Required<CompressionConfig> = {
    compress_threshold: config.compress_threshold ?? DEFAULT_COMPRESSION_CONFIG.compress_threshold,
    preserve_recent: config.preserve_recent ?? DEFAULT_COMPRESSION_CONFIG.preserve_recent,
    min_summarizable: config.min_summarizable ?? DEFAULT_COMPRESSION_CONFIG.min_summarizable,
  };

  const now = Date.now();

  // 保留最近 N 条消息（尾部锚定）
  const preserved = messages.slice(-resolved_config.preserve_recent);
  const to_compress = messages.slice(0, -resolved_config.preserve_recent);

  // 消息太少，不值得压缩，直接截断
  if (to_compress.length < resolved_config.min_summarizable) {
    return {
      compressed: preserved,
      metadata: {
        type: 'truncate',
        original_count: messages.length,
        preserved_count: preserved.length,
        compressed_at: now,
      },
    };
  }

  // 有 LLM provider，尝试生成摘要
  if (provider) {
    try {
      const summary_prompt = build_summarize_prompt(to_compress);
      const summary_response = await provider.chat([
        { role: 'user', content: summary_prompt },
      ]);

      const summary_msg: Message = {
        role: 'system',
        content: `【历史摘要】${summary_response.content}`,
        timestamp: now,
      };

      return {
        compressed: [summary_msg, ...preserved],
        metadata: {
          type: 'summarize',
          original_count: messages.length,
          preserved_count: preserved.length + 1,
          compressed_at: now,
        },
      };
    } catch {
      // LLM 调用失败，降级为直接截断
      return {
        compressed: preserved,
        metadata: {
          type: 'truncate',
          original_count: messages.length,
          preserved_count: preserved.length,
          compressed_at: now,
        },
      };
    }
  }

  // 无 LLM provider，直接截断
  return {
    compressed: preserved,
    metadata: {
      type: 'truncate',
      original_count: messages.length,
      preserved_count: preserved.length,
      compressed_at: now,
    },
  };
}

/**
 * 递归压缩——压缩后仍超限时递归再压
 */
export async function compress_session_recursive(
  messages: Message[],
  config: CompressionConfig,
  provider: LLMProvider,
  max_iterations = 3,
): Promise<{ compressed: Message[]; metadata: CompressionMetadata }> {
  let current = messages;
  let last_metadata: CompressionMetadata | null = null;

  for (let i = 0; i < max_iterations; i++) {
    if (!needs_compression(current, config)) {
      break;
    }
    const result = await compress_session(current, config, provider);
    current = result.compressed;
    last_metadata = result.metadata;
  }

  return {
    compressed: current,
    metadata:
      last_metadata ??
      {
        type: 'truncate',
        original_count: messages.length,
        preserved_count: messages.length,
        compressed_at: Date.now(),
      },
  };
}
