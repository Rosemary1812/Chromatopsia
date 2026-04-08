// T-05: OpenAI Provider implementation
// This file will be implemented in T-05
import type { LLMProvider, ProviderConfig, Message, ToolDefinition, StreamOptions, LLMResponse } from './provider.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';

  constructor(_config: ProviderConfig) {
    throw new Error('OpenAIProvider not implemented yet');
  }

  chat(_messages: Message[], _tools?: ToolDefinition[]): Promise<LLMResponse> {
    throw new Error('OpenAIProvider not implemented yet');
  }

  chat_stream(
    _messages: Message[],
    _tools?: ToolDefinition[],
    _options?: StreamOptions,
  ): AsyncGenerator<string, LLMResponse, void> {
    throw new Error('OpenAIProvider not implemented yet');
  }

  get_model(): string {
    throw new Error('OpenAIProvider not implemented yet');
  }
}
