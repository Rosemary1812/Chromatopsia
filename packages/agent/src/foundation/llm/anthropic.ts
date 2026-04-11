// ============================================================
// Anthropic LLM Provider Implementation
// ============================================================
// T-04: Anthropic Provider with streaming, retry, and tool support

import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic | null = null;
  private config: ProviderConfig | null = null;
  private model: string;

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
    if (msg.role === 'system') {
      return {
        role: 'user',
        content: [{ type: 'text', text: msg.content }],
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

    const systemParts: string[] = [];
    const conversationMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemParts.push(msg.content);
      } else {
        conversationMessages.push(this.toApiMessage(msg));
      }
    }

    const systemContent = systemParts.join('\n\n');

    // Guard: Minimax requires messages array to be non-empty
    if (conversationMessages.length === 0) {
      conversationMessages.push({
        role: 'user',
        content: [{ type: 'text', text: '.' }] as unknown as string,
      } as Anthropic.MessageParam);
    }

    const anthropicTools = tools ? this.toAnthropicTools(tools) : undefined;
    const maxTokens = this.config?.max_tokens ?? DEFAULT_MAX_TOKENS;

    try {
      const response = await backOff(
        async () =>
          this.client!.messages.create({
            model: this.model,
            max_tokens: maxTokens,
            system: systemContent || undefined,
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

      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          const tc = this.toInternalToolCall(block);
          if (tc) toolCalls.push(tc);
        }
      }

      return {
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(
          `Anthropic API error (${error.status}): ${error.message}`
        );
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

    const systemParts: string[] = [];
    const conversationMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemParts.push(msg.content);
      } else {
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

    const systemContent = systemParts.join('\n\n');
    const anthropicTools = tools ? this.toAnthropicTools(tools) : undefined;
    const maxTokens = this.config?.max_tokens ?? DEFAULT_MAX_TOKENS;

    try {
      const stream = await backOff(
        async () => this.client!.messages.stream({
          model: this.model,
          max_tokens: maxTokens,
          system: systemContent || undefined,
          messages: conversationMessages,
          tools: anthropicTools,
        }),
        {
          numOfAttempts: MAX_RETRIES,
          startingDelay: 1000,
        }
      );

      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      // Accumulate partial JSON for streaming tool calls
      const partialJsonAccumulator = new Map<string, string>();

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            const tc: ToolCall = {
              id: block.id,
              name: block.name,
              arguments: {},
            };
            partialJsonAccumulator.set(block.id, '');
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
          } else if (delta.type === 'input_json_delta') {
            // Accumulate tool input JSON fragments by tool call id
            if (toolCalls.length > 0) {
              const lastTc = toolCalls[toolCalls.length - 1];
              const accumulated = partialJsonAccumulator.get(lastTc.id) ?? '';
              partialJsonAccumulator.set(lastTc.id, accumulated + delta.partial_json);
            }
          }
        } else if (event.type === 'content_block_stop') {
          // Content block is done - finalize tool call arguments
          if (toolCalls.length > 0) {
            const lastTc = toolCalls[toolCalls.length - 1];
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

      // Note: the return value is what the for...of receives when the generator finishes
      return {
        content: fullContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(
          `Anthropic API error (${error.status}): ${error.message}`
        );
      }
      throw error;
    }
  }
}
