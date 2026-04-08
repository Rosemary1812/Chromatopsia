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

  // Convert internal Message to Anthropic MessageParam
  private toAnthropicMessage(
    message: Message
  ): { role: 'user' | 'assistant'; content: string } {
    return {
      role: message.role as 'user' | 'assistant',
      content: message.content,
    };
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

  async chat(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('AnthropicProvider not initialized');
    }

    const anthropicMessages = messages.map((m) => this.toAnthropicMessage(m));
    const anthropicTools = tools ? this.toAnthropicTools(tools) : undefined;
    const maxTokens = this.config?.max_tokens ?? DEFAULT_MAX_TOKENS;

    try {
      const response = await backOff(
        async () =>
          this.client!.messages.create({
            model: this.model,
            max_tokens: maxTokens,
            messages: anthropicMessages,
            tools: anthropicTools,
          }),
        {
          numOfAttempts: MAX_RETRIES,
          startingDelay: 1000,
          retry: (e: Error) => {
            // Don't retry on API errors that won't be fixed by retrying
            if (e instanceof Anthropic.APIError) {
              // Rate limit errors are retriable
              if (e.status === 429) return true;
              // Auth errors should not be retried
              if (e.status === 401 || e.status === 403) return false;
            }
            // Don't retry on other errors (network, etc.)
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

    const anthropicMessages = messages.map((m) => this.toAnthropicMessage(m));
    const anthropicTools = tools ? this.toAnthropicTools(tools) : undefined;
    const maxTokens = this.config?.max_tokens ?? DEFAULT_MAX_TOKENS;

    const systemHint = options?.system_hint;
    // Prepend system hint to first user message if present
    if (systemHint && anthropicMessages.length > 0) {
      const first = anthropicMessages[0];
      if (first.role === 'user') {
        first.content = `System hint: ${systemHint}\n\n${first.content}`;
      }
    }

    try {
      const stream = await backOff(
        async () => this.client!.messages.stream({
          model: this.model,
          max_tokens: maxTokens,
          messages: anthropicMessages,
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
