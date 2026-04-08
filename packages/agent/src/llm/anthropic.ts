// T-04: Anthropic Provider implementation
// This file will be implemented in T-04
import type { LLMProvider, ProviderConfig, Message, ToolDefinition, StreamOptions, LLMResponse } from './provider.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';

  constructor(_config: ProviderConfig) {
    throw new Error('AnthropicProvider not implemented yet');
  }

  chat(_messages: Message[], _tools?: ToolDefinition[]): Promise<LLMResponse> {
    throw new Error('AnthropicProvider not implemented yet');
  }

  chat_stream(
    _messages: Message[],
    _tools?: ToolDefinition[],
    _options?: StreamOptions,
  ): AsyncGenerator<string, LLMResponse, void> {
    throw new Error('AnthropicProvider not implemented yet');
  }

  get_model(): string {
    throw new Error('AnthropicProvider not implemented yet');
  }
}
