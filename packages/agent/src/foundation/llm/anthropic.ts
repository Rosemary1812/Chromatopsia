// ============================================================
// Anthropic LLM Provider Implementation
// ============================================================
// T-04: Anthropic Provider with streaming, retry, and tool support

import Anthropic from '@anthropic-ai/sdk';
// @ts-ignore - exponential-backoff is ESM only
import { backOff } from 'exponential-backoff';
import type {
  LLMProvider,
  ProviderConfig,
  Message,
  ToolDefinition,
  StreamOptions,
  LLMResponse,
  ToolCall,
} from '../types.js';

const DEFAULT_MODEL = 'claude-opus-4-6';
const DEFAULT_MAX_TOKENS = 8192;
const MAX_RETRIES = 3;

function formatAnthropicError(error: { message: string; status?: number }): Error {
  if (typeof error.status === 'number') {
    return new Error(`Anthropic API error (${error.status}): ${error.message}`);
  }
  return new Error(`Anthropic connection error: ${error.message}`);
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic | null = null;
  private config: ProviderConfig | null = null;
  private model: string;
  private turnNumber: number = 0;

  constructor(config: ProviderConfig) {
    this.init(config);
    this.model = config.model ?? DEFAULT_MODEL;
  }

  init(config: ProviderConfig): void {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.api_key,
      baseURL: config.base_url ?? undefined,
      timeout: config.timeout ?? undefined,
    });
  }

  get_model(): string {
    return this.model;
  }

  // Convert internal ToolDefinition to Anthropic Tool format
  private toAnthropicTools(
    tools: ToolDefinition[]
  ): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
    }));
  }

  // Convert Anthropic tool_use content block to internal ToolCall
  private toInternalToolCall(
    block: { type: string; id: string; name: string; input: unknown }
  ): ToolCall | null {
    if (block.type !== 'tool_use') return null;
    return {
      id: block.id,
      name: block.name,
      arguments: block.input as Record<string, unknown>,
    };
  }

  private buildSystemPrompt(messages: Message[]): Array<Record<string, unknown>> | undefined {
    const systemBlocks = messages
      .filter((msg) => msg.role === 'system')
      .map((msg) => ({
        type: 'text',
        text: msg.content,
        ...(msg.cache_control ? { cache_control: msg.cache_control } : {}),
      }));

    return systemBlocks.length > 0 ? systemBlocks : undefined;
  }

  // Convert internal Message to Anthropic API message format.
  // Minimax requires content to be a block array: [{ type: 'text', text: '...' }]
  // tool role messages must include the tool_call_id.
  private toApiMessage(msg: Message): Anthropic.MessageParam {
    if (msg.role === 'tool') {
      const toolResult = msg.tool_results?.[0];
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolResult?.tool_call_id ?? 'unknown',
          content: msg.content,
        }] as unknown as string,
      } as Anthropic.MessageParam;
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const blocks: Array<Record<string, unknown>> = [];
      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      return {
        role: 'assistant',
        content: blocks as unknown as string,
      } as Anthropic.MessageParam;
    }
    // user or assistant: must be block array
    const text = msg.content || '.';
    return {
      role: msg.role,
      content: [{ type: 'text', text }] as unknown as string,
    } as Anthropic.MessageParam;
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('AnthropicProvider not initialized');
    }

    this.turnNumber++;

    const systemContent = this.buildSystemPrompt(messages);
    
    // P0-3: 激活缓存注解 — 在 system 块上标记缓存
    const systemWithCache = systemContent?.map((block, idx) => ({
      ...block,
      // 在第一条 system 块上标记缓存（只需一次）
      ...(idx === 0 ? { cache_control: { type: 'ephemeral' } } : {}),
    }));

    const conversationMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role !== 'system') {
        conversationMessages.push(this.toApiMessage(msg));
      }
    }

    // Guard: Minimax requires messages array to be non-empty
    if (conversationMessages.length === 0) {
      conversationMessages.push({
        role: 'user',
        content: [{ type: 'text', text: '.' }] as unknown as string,
      } as Anthropic.MessageParam);
    }

    // P0-3: 激活缓存注解 — 在最后一条消息上标记缓存
    if (conversationMessages.length > 0) {
      const lastIdx = conversationMessages.length - 1;
      const lastMsg = conversationMessages[lastIdx] as any;
      lastMsg.cache_control = { type: 'ephemeral' };
    }

    const anthropicTools = tools ? this.toAnthropicTools(tools) : undefined;
    const maxTokens = this.config?.max_tokens ?? DEFAULT_MAX_TOKENS;

    try {
      const response = await backOff(
        async () =>
          this.client!.messages.create({
            model: this.model,
            max_tokens: maxTokens,
            system: (systemWithCache || undefined) as any,
            messages: conversationMessages,
            tools: anthropicTools,
          }),
        {
          numOfAttempts: MAX_RETRIES,
          startingDelay: 1000,
          retry: (e: Error) => {
            if (e instanceof Anthropic.APIError) {
              if (e.status === 429) return true;
              if (e.status === 401 || e.status === 403) return false;
            }
            return false;
          },
        }
      );

      const toolCalls: ToolCall[] = [];
      let content = '';
      let reasoning = '';

      for (const block of response.content as any[]) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'thinking') {
          reasoning += block.thinking;
        } else if (block.type === 'tool_use') {
          const tc = this.toInternalToolCall(block);
          if (tc) toolCalls.push(tc);
        }
      }

      // P0-3: 缓存统计日志
      const usage = response.usage as any;
      if (usage?.cache_creation_input_tokens && usage.cache_creation_input_tokens > 0) {
        console.debug(`[Cache] Created: ${usage.cache_creation_input_tokens} tokens cached`);
      }
      if (usage?.cache_read_input_tokens && usage.cache_read_input_tokens > 0) {
        console.debug(`[Cache] Hit: read ${usage.cache_read_input_tokens} tokens from cache, saved ${Math.round(usage.cache_read_input_tokens * 0.9)} tokens (90% discount)`);
      }

      return {
        content,
        reasoning: reasoning || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw formatAnthropicError(error);
      }
      throw error;
    }
  }

  async *chat_stream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: StreamOptions
  ): AsyncGenerator<string, LLMResponse, void> {
    if (!this.client) {
      throw new Error('AnthropicProvider not initialized');
    }

    this.turnNumber++;

    const systemContent = this.buildSystemPrompt(messages);
    
    // P0-3: 激活缓存注解 — 在 system 块上标记缓存
    const systemWithCache = systemContent?.map((block, idx) => ({
      ...block,
      // 在第一条 system 块上标记缓存（只需一次）
      ...(idx === 0 ? { cache_control: { type: 'ephemeral' } } : {}),
    }));

    const conversationMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role !== 'system') {
        conversationMessages.push(this.toApiMessage(msg));
      }
    }

    // Guard: Minimax requires messages array to be non-empty
    if (conversationMessages.length === 0) {
      conversationMessages.push({
        role: 'user',
        content: [{ type: 'text', text: '.' }] as unknown as string,
      } as Anthropic.MessageParam);
    }

    // P0-3: 激活缓存注解 — 在最后一条消息上标记缓存
    if (conversationMessages.length > 0) {
      const lastIdx = conversationMessages.length - 1;
      const lastMsg = conversationMessages[lastIdx] as any;
      lastMsg.cache_control = { type: 'ephemeral' };
    }

    const anthropicTools = tools ? this.toAnthropicTools(tools) : undefined;
    const maxTokens = this.config?.max_tokens ?? DEFAULT_MAX_TOKENS;

    try {
      const stream = await backOff(
        async () => this.client!.messages.stream({
          model: this.model,
          max_tokens: maxTokens,
          system: (systemWithCache || undefined) as any,
          messages: conversationMessages,
          tools: anthropicTools,
        }),
        {
          numOfAttempts: MAX_RETRIES,
          startingDelay: 1000,
        }
      );

      let fullContent = '';
      let fullReasoning = '';
      const toolCalls: ToolCall[] = [];
      // Accumulate partial JSON for streaming tool calls
      const partialJsonAccumulator = new Map<string, string>();
      const blockToolCallIds = new Map<number, string>();

      for await (const rawEvent of stream as any) {
        const event = rawEvent as any;
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            const tc: ToolCall = {
              id: block.id,
              name: block.name,
              arguments: {},
            };
            partialJsonAccumulator.set(block.id, '');
            if (typeof event.index === 'number') {
              blockToolCallIds.set(event.index, block.id);
            }
            toolCalls.push(tc);
            if (options?.on_tool_call_start) {
              options.on_tool_call_start(tc);
            }
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            fullContent += delta.text;
            yield delta.text;
          } else if (delta.type === 'thinking_delta') {
            fullReasoning += delta.thinking;
          } else if (delta.type === 'input_json_delta') {
            // Accumulate tool input JSON fragments by tool call id
            const toolCallId = typeof event.index === 'number'
              ? blockToolCallIds.get(event.index)
              : toolCalls[toolCalls.length - 1]?.id;
            if (toolCallId) {
              const accumulated = partialJsonAccumulator.get(toolCallId) ?? '';
              partialJsonAccumulator.set(toolCallId, accumulated + delta.partial_json);
            }
          }
        } else if (event.type === 'content_block_stop') {
          // Content block is done - finalize tool call arguments
          const toolCallId = typeof event.index === 'number'
            ? blockToolCallIds.get(event.index)
            : toolCalls[toolCalls.length - 1]?.id;
          const lastTc = toolCallId
            ? toolCalls.find((toolCall) => toolCall.id === toolCallId)
            : toolCalls[toolCalls.length - 1];
          if (lastTc) {
            const partialJson = partialJsonAccumulator.get(lastTc.id);
            if (partialJson) {
              try {
                lastTc.arguments = JSON.parse(partialJson);
              } catch {
                // Keep partial JSON on parse failure
              }
              partialJsonAccumulator.delete(lastTc.id);
            }
            if (options?.on_tool_call_end) {
              options.on_tool_call_end(lastTc, {
                tool_call_id: lastTc.id,
                output: '',
                success: false,
              });
            }
          }
        }
      }

      // P0-3: 缓存统计日志（streaming）
      const finalMessage = stream.finalMessage() as any;
      const usage = finalMessage?.usage;
      if (usage?.cache_creation_input_tokens && usage.cache_creation_input_tokens > 0) {
        console.debug(`[Cache] Created: ${usage.cache_creation_input_tokens} tokens cached`);
      }
      if (usage?.cache_read_input_tokens && usage.cache_read_input_tokens > 0) {
        console.debug(`[Cache] Hit: read ${usage.cache_read_input_tokens} tokens from cache, saved ${Math.round(usage.cache_read_input_tokens * 0.9)} tokens (90% discount)`);
      }

      // Note: the return value is what the for...of receives when the generator finishes
      return {
        content: fullContent,
        reasoning: fullReasoning || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw formatAnthropicError(error);
      }
      throw error;
    }
  }
}
