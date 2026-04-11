// T-05: OpenAI Provider implementation
import OpenAI from 'openai';
import type { LLMProvider, ProviderConfig, Message, ToolDefinition, StreamOptions, LLMResponse, ToolCall } from './provider.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.api_key,
      baseURL: config.base_url,
      timeout: config.timeout,
    });
    this.model = config.model ?? 'gpt-4o';
  }

  get_model(): string {
    return this.model;
  }

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const openaiMessages = this.convertMessages(messages);
    const openaiTools = this.convertTools(tools);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: 'auto',
    });

    return this.convertResponse(response);
  }

  async *chat_stream(
    messages: Message[],
    tools?: ToolDefinition[],
    _options?: StreamOptions,
  ): AsyncGenerator<string, LLMResponse, void> {
    const openaiMessages = this.convertMessages(messages);
    const openaiTools = this.convertTools(tools);

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: 'auto',
      stream: true,
    });

    let fullContent = '';
    let finishReason: 'stop' | 'tool_use' = 'stop';
    let toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        fullContent += delta.content;
        yield delta.content;
      }

      if (delta.tool_calls) {
        finishReason = 'tool_use';
        for (const tc of delta.tool_calls) {
          if (tc.id && tc.function) {
            let args: Record<string, unknown> = {};
            if (tc.function.arguments) {
              try {
                args = JSON.parse(tc.function.arguments);
              } catch {
                args = {};
              }
            }
            toolCalls.push({
              id: tc.id ?? `tc-${Date.now()}`,
              name: tc.function.name ?? 'unknown',
              arguments: args,
            });
          }
        }
      }
    }

    return { content: fullContent, tool_calls: toolCalls, finish_reason: finishReason };
  }

  private convertMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        const toolResult = msg.tool_results?.[0];
        return {
          role: 'tool' as const,
          tool_call_id: toolResult?.tool_call_id ?? 'unknown',
          content: msg.content,
        };
      }

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        return {
          role: 'assistant' as const,
          content: msg.content || '',
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id || `tc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }

      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }

  private convertTools(
    tools?: ToolDefinition[],
  ): OpenAI.Chat.ChatCompletionTool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    })) as unknown as OpenAI.Chat.ChatCompletionTool[];
  }

  private convertResponse(
    response: OpenAI.Chat.ChatCompletion,
  ): LLMResponse {
    const choice = response.choices[0];
    if (!choice) {
      return { content: '', finish_reason: 'stop' };
    }

    const message = choice.message;
    let toolCalls: ToolCall[] | undefined;

    if (message.tool_calls?.length) {
      toolCalls = message.tool_calls.map((tc) => {
        let args: Record<string, unknown> = {};
        if (tc.function.arguments) {
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        };
      });
    }

    return {
      content: message.content ?? '',
      tool_calls: toolCalls,
      finish_reason: toolCalls?.length ? 'tool_use' : 'stop',
    };
  }
}
