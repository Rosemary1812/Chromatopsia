// T-05: OpenAI / OpenAI-compatible Provider implementation
import OpenAI from 'openai';
import type {
  LLMProvider,
  ProviderConfig,
  Message,
  ToolDefinition,
  StreamOptions,
  LLMResponse,
  ToolCall,
} from './provider.js';

type OpenAIToolCallAccumulator = {
  id: string;
  name: string;
  argumentsText: string;
};

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
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: this.convertMessages(messages),
      tools: this.convertTools(tools),
      tool_choice: 'auto',
    });

    return this.convertResponse(response);
  }

  async *chat_stream(
    messages: Message[],
    tools?: ToolDefinition[],
    _options?: StreamOptions,
  ): AsyncGenerator<string, LLMResponse, void> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: this.convertMessages(messages),
      tools: this.convertTools(tools),
      tool_choice: 'auto',
      stream: true,
    });

    let fullContent = '';
    let fullReasoning = '';
    let finishReason: 'stop' | 'tool_use' = 'stop';
    const toolCalls = new Map<number, OpenAIToolCallAccumulator>();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (!delta) continue;

      if (delta.content) {
        fullContent += delta.content;
        yield delta.content;
      }

      const reasoningChunk = this.extractReasoning(delta);
      if (reasoningChunk) {
        fullReasoning += reasoningChunk;
      }

      if (delta.tool_calls?.length) {
        finishReason = 'tool_use';
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index ?? 0;
          const current = toolCalls.get(index) ?? {
            id: '',
            name: '',
            argumentsText: '',
          };
          if (toolCallDelta.id) current.id = toolCallDelta.id;
          if (toolCallDelta.function?.name) current.name += toolCallDelta.function.name;
          if (toolCallDelta.function?.arguments) {
            current.argumentsText += toolCallDelta.function.arguments;
          }
          toolCalls.set(index, current);
        }
      }

      if (choice?.finish_reason === 'tool_calls') {
        finishReason = 'tool_use';
      }
    }

    const finalizedToolCalls = this.finalizeToolCalls(toolCalls);
    return {
      content: fullContent,
      reasoning: fullReasoning || undefined,
      tool_calls: finalizedToolCalls.length > 0 ? finalizedToolCalls : undefined,
      finish_reason: finalizedToolCalls.length > 0 ? 'tool_use' : finishReason,
      token_usage: undefined,
    };
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

  private finalizeToolCalls(toolCalls: Map<number, OpenAIToolCallAccumulator>): ToolCall[] {
    return Array.from(toolCalls.entries())
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => ({
        id: toolCall.id || `tc-${Date.now()}`,
        name: toolCall.name || 'unknown',
        arguments: this.parseArguments(toolCall.argumentsText),
      }));
  }

  private parseArguments(argumentsText?: string): Record<string, unknown> {
    if (!argumentsText) return {};
    try {
      return JSON.parse(argumentsText) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private extractReasoning(value: unknown): string {
    if (!value || typeof value !== 'object') return '';

    const candidate = value as { reasoning_content?: unknown };
    const raw = candidate.reasoning_content;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      return raw
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
            return part.text;
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  private convertResponse(response: OpenAI.Chat.ChatCompletion): LLMResponse {
    const choice = response.choices[0];
    if (!choice) {
      return { content: '', finish_reason: 'stop' };
    }

    const message = choice.message as OpenAI.Chat.ChatCompletionMessage & {
      reasoning_content?: string | Array<{ text?: string } | string>;
    };
    const toolCalls = message.tool_calls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: this.parseArguments(toolCall.function.arguments),
    }));

    return {
      content: message.content ?? '',
      reasoning: this.extractReasoning(message as unknown as Record<string, unknown>) || undefined,
      tool_calls: toolCalls?.length ? toolCalls : undefined,
      finish_reason: toolCalls?.length ? 'tool_use' : 'stop',
      token_usage: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
