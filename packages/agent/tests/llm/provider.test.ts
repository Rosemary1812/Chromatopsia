import { describe, it, expect, type Mock, vi } from 'vitest';
import type {
  LLMProvider,
  ProviderConfig,
  StreamOptions,
  LLMResponse,
  Message,
  ToolDefinition,
} from '../src/types.js';

// Re-export for convenience in tests
export type { LLMProvider, ProviderConfig, StreamOptions, LLMResponse, Message, ToolDefinition };

describe('LLMProvider interface', () => {
  // Helper to create a mock provider for interface testing
  function createMockProvider(): LLMProvider {
    return {
      name: 'mock',
      chat: vi.fn().mockResolvedValue({
        content: 'mock response',
        finish_reason: 'stop',
      } as LLMResponse),
      chat_stream: vi.fn().mockReturnValue(async function* () {
        yield 'chunk1';
        yield 'chunk2';
      }()),
      get_model: () => 'mock-model',
    };
  }

  describe('LLMProvider interface contract', () => {
    it('should have a name property', () => {
      const provider = createMockProvider();
      expect(typeof provider.name).toBe('string');
      expect(provider.name).toBe('mock');
    });

    it('should implement chat() method', () => {
      const provider = createMockProvider();
      expect(typeof provider.chat).toBe('function');
    });

    it('should implement chat_stream() method', () => {
      const provider = createMockProvider();
      expect(typeof provider.chat_stream).toBe('function');
    });

    it('should implement get_model() method', () => {
      const provider = createMockProvider();
      expect(typeof provider.get_model).toBe('function');
      expect(provider.get_model()).toBe('mock-model');
    });

    it('chat() should accept messages and optional tools', async () => {
      const provider = createMockProvider();
      const messages: Message[] = [{ role: 'user', content: 'hello' }];

      const result = await provider.chat(messages);
      expect(result).toBeDefined();
      expect(result.content).toBe('mock response');
      expect(result.finish_reason).toBe('stop');
    });

    it('chat() should work without tools parameter', async () => {
      const provider = createMockProvider();
      const messages: Message[] = [{ role: 'user', content: 'hello' }];

      await expect(provider.chat(messages)).resolves.toBeDefined();
    });

    it('chat_stream() should be an async generator', async () => {
      const provider = createMockProvider();
      const messages: Message[] = [{ role: 'user', content: 'hello' }];

      const stream = provider.chat_stream(messages);
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('chat_stream() should yield chunks via manual next() calls', async () => {
      const provider = createMockProvider();
      const messages: Message[] = [{ role: 'user', content: 'hello' }];

      const stream = provider.chat_stream(messages);

      const first = await stream.next();
      expect(first.value).toBe('chunk1');
      expect(first.done).toBe(false);

      const second = await stream.next();
      expect(second.value).toBe('chunk2');
      expect(second.done).toBe(false);

      const final = await stream.next();
      expect(final.done).toBe(true);
    });
  });

  describe('StreamOptions', () => {
    it('should allow system_hint option', () => {
      const options: StreamOptions = {
        system_hint: 'You are a helpful assistant.',
      };
      expect(options.system_hint).toBe('You are a helpful assistant.');
    });

    it('should allow on_tool_call_start callback', () => {
      const onStart: Mock = vi.fn();
      const options: StreamOptions = {
        on_tool_call_start: onStart,
      };
      expect(typeof options.on_tool_call_start).toBe('function');
    });

    it('should allow on_tool_call_end callback', () => {
      const onEnd: Mock = vi.fn();
      const options: StreamOptions = {
        on_tool_call_end: onEnd,
      };
      expect(typeof options.on_tool_call_end).toBe('function');
    });

    it('should allow all options together', () => {
      const onStart: Mock = vi.fn();
      const onEnd: Mock = vi.fn();
      const options: StreamOptions = {
        system_hint: 'hint',
        on_tool_call_start: onStart,
        on_tool_call_end: onEnd,
      };
      expect(options.system_hint).toBe('hint');
      expect(options.on_tool_call_start).toBe(onStart);
      expect(options.on_tool_call_end).toBe(onEnd);
    });
  });

  describe('ProviderConfig', () => {
    it('should require api_key', () => {
      const config: ProviderConfig = {
        api_key: 'test-key',
      };
      expect(config.api_key).toBe('test-key');
    });

    it('should allow optional fields', () => {
      const config: ProviderConfig = {
        api_key: 'test-key',
        base_url: 'https://api.example.com',
        model: 'gpt-4',
        max_tokens: 8192,
        timeout: 60000,
      };
      expect(config.base_url).toBe('https://api.example.com');
      expect(config.model).toBe('gpt-4');
      expect(config.max_tokens).toBe(8192);
      expect(config.timeout).toBe(60000);
    });

    it('should work with minimal config', () => {
      const config: ProviderConfig = {
        api_key: 'test-key',
      };
      expect(config.api_key).toBe('test-key');
      expect(config.base_url).toBeUndefined();
      expect(config.model).toBeUndefined();
    });
  });

  describe('LLMResponse', () => {
    it('should have content and finish_reason', () => {
      const response: LLMResponse = {
        content: 'Hello, world!',
        finish_reason: 'stop',
      };
      expect(response.content).toBe('Hello, world!');
      expect(response.finish_reason).toBe('stop');
    });

    it('should allow tool_calls when finish_reason is tool_use', () => {
      const response: LLMResponse = {
        content: '',
        tool_calls: [
          {
            id: 'tc-1',
            name: 'run_shell',
            arguments: { command: 'ls' },
          },
        ],
        finish_reason: 'tool_use',
      };
      expect(response.tool_calls).toHaveLength(1);
      expect(response.tool_calls![0].name).toBe('run_shell');
      expect(response.finish_reason).toBe('tool_use');
    });
  });
});
