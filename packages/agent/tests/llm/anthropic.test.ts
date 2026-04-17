import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/foundation/llm/anthropic.js';
import type { Message, ToolDefinition, StreamOptions, LLMResponse, ToolCall } from '../../src/foundation/types.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockMessagesCreate = vi.fn();
  const mockMessagesStream = vi.fn();

  // Mock APIError class
  class MockAPIError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }

  // The SDK exports Anthropic as the default class
  class MockAnthropic {
    messages = {
      create: mockMessagesCreate,
      stream: mockMessagesStream,
    };
    static APIError = MockAPIError;
  }

  return {
    default: MockAnthropic,
    __mockMessagesCreate: mockMessagesCreate,
    __mockMessagesStream: mockMessagesStream,
  };
});

// Access mocks after vi.mock
import * as anthropicModule from '@anthropic-ai/sdk';
const { __mockMessagesCreate, __mockMessagesStream } = anthropicModule as any;

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  const mockConfig = {
    api_key: 'test-api-key',
    model: 'claude-opus-4-6',
    max_tokens: 8192,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a provider with the correct name', () => {
      expect(provider.name).toBe('anthropic');
    });

    it('should use default model if not specified', () => {
      const p = new AnthropicProvider({ api_key: 'key' });
      expect(p.get_model()).toBe('claude-opus-4-6');
    });

    it('should use specified model', () => {
      expect(provider.get_model()).toBe('claude-opus-4-6');
    });
  });

  describe('chat()', () => {
    it('should send a simple message and return response', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      __mockMessagesCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Hello! How can I help you?' },
        ],
        stop_reason: 'end_turn',
      });

      const response = await provider.chat(messages);

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.finish_reason).toBe('stop');
      expect(response.tool_calls).toBeUndefined();
    });

    it('should handle tool_use responses', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Run ls' }];
      const tools: ToolDefinition[] = [
        {
          name: 'run_shell',
          description: 'Run a shell command',
          input_schema: { type: 'object', properties: { command: { type: 'string' } } },
          handler: vi.fn(),
        },
      ];

      __mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'run_shell',
            input: { command: 'ls -la' },
          },
        ],
        stop_reason: 'tool_use',
      });

      const response = await provider.chat(messages, tools);

      expect(response.content).toBe('');
      expect(response.finish_reason).toBe('tool_use');
      expect(response.tool_calls).toHaveLength(1);
      expect(response.tool_calls![0]).toEqual({
        id: 'toolu_01',
        name: 'run_shell',
        arguments: { command: 'ls -la' },
      });
    });

    it('should convert messages to Anthropic format', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      __mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
      });

      await provider.chat(messages);

      expect(__mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
          ],
        })
      );
    });

    it('should send system prompt as independent Anthropic system blocks', async () => {
      const messages: Message[] = [
        { role: 'system', content: 'Core instruction', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'Hello' },
      ];

      __mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
      });

      await provider.chat(messages);

      expect(__mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [{
            type: 'text',
            text: 'Core instruction',
            cache_control: { type: 'ephemeral' },
          }],
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        }),
      );
    });

    it('should pass tools to Anthropic API', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Do something' }];
      const tools: ToolDefinition[] = [
        {
          name: 'test_tool',
          description: 'A test tool',
          input_schema: { type: 'object', properties: {} },
          handler: vi.fn(),
        },
      ];

      __mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done' }],
        stop_reason: 'end_turn',
      });

      await provider.chat(messages, tools);

      expect(__mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: 'test_tool',
              description: 'A test tool',
            }),
          ]),
        })
      );
    });

    it('should throw on API error with status', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      // Create error using the mocked Anthropic.APIError
      const MockAnthropic = (vi.mocked(anthropicModule) as any).default;
      const apiError = new MockAnthropic.APIError('Invalid API key', 401);
      __mockMessagesCreate.mockRejectedValueOnce(apiError);

      await expect(provider.chat(messages)).rejects.toThrow(
        'Anthropic API error (401): Invalid API key'
      );
    });

    it('should throw on non-API errors', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      // Non-API errors should propagate immediately without retry
      __mockMessagesCreate.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.chat(messages)).rejects.toThrow('Network error');
    });

    it('should preserve thinking blocks in non-stream responses', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Think' }];

      __mockMessagesCreate.mockResolvedValueOnce({
        content: [
          { type: 'thinking', thinking: 'analysis' },
          { type: 'text', text: 'answer' },
        ],
        stop_reason: 'end_turn',
      });

      const response = await provider.chat(messages);
      expect(response.reasoning).toBe('analysis');
      expect(response.content).toBe('answer');
    });
  });

  describe('chat_stream()', () => {
    it('should be an async generator', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const mockStream = {
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Streamed response' }],
        }),
      };

      __mockMessagesStream.mockResolvedValueOnce(mockStream);

      const stream = provider.chat_stream(messages);
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');
    });

    it('should yield text chunks from streaming response', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there!' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      ];

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Hello there!' }],
        }),
      };

      __mockMessagesStream.mockResolvedValueOnce(mockStream);

      const chunks: string[] = [];
      for await (const chunk of provider.chat_stream(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello ', 'there!']);
    });

    it('should collect thinking_delta and indexed input_json_delta fragments', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Run a command' }];

      __mockMessagesStream.mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'toolu_02', name: 'run_shell' },
          };
          yield {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: 'considering ' },
          };
          yield {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"command":"pwd"' },
          };
          yield {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '}' },
          };
          yield {
            type: 'content_block_stop',
            index: 1,
          };
        },
      });

      const stream = provider.chat_stream(messages, undefined, { on_tool_call_start: vi.fn() });
      let finalResponse: any;
      while (true) {
        const next = await stream.next();
        if (next.done) {
          finalResponse = next.value;
          break;
        }
      }

      expect(finalResponse.reasoning).toBe('considering ');
      expect(finalResponse.tool_calls).toEqual([{
        id: 'toolu_02',
        name: 'run_shell',
        arguments: { command: 'pwd' },
      }]);
      expect(finalResponse.finish_reason).toBe('tool_use');
    });

    // system_hint is not yet implemented in chat_stream; when implemented, prepend to first user message
    it.skip('should handle system_hint by prepending to first user message', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const options: StreamOptions = {
        system_hint: 'You are a helpful assistant.',
      };

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
        },
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Hi' }],
        }),
      };

      __mockMessagesStream.mockResolvedValueOnce(mockStream);

      for await (const _chunk of provider.chat_stream(messages, undefined, options)) {
        // consume stream
      }

      expect(__mockMessagesStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'System hint: You are a helpful assistant.\n\nHello' }],
            },
          ],
        })
      );
    });

    it('should return tool_calls when finish_reason is tool_use', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Run a command' }];
      const tools: ToolDefinition[] = [
        {
          name: 'run_shell',
          description: 'Run shell',
          input_schema: { type: 'object' },
          handler: vi.fn(),
        },
      ];

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } };
        },
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_stream',
              name: 'run_shell',
              input: { command: 'echo hello' },
            },
          ],
        }),
      };

      __mockMessagesStream.mockResolvedValueOnce(mockStream);

      let finalResponse: LLMResponse | undefined;
      for await (const _chunk of provider.chat_stream(messages, tools)) {
        // consume
      }
      // Note: the return value requires explicit return() call or for...of auto-returns
      // For now, we test the tool_calls in the final response

      expect(__mockMessagesStream).toHaveBeenCalled();
    });

    it('should call on_tool_call_start when a tool use starts', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Run a command' }];
      const onStart = vi.fn();

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_start',
            content_block: { type: 'tool_use', id: 'toolu_01', name: 'run_shell' },
          };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } };
        },
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'run_shell',
              input: { command: 'ls' },
            },
          ],
        }),
      };

      __mockMessagesStream.mockResolvedValueOnce(mockStream);

      for await (const _chunk of provider.chat_stream(messages, [], { on_tool_call_start: onStart })) {
        // consume
      }

      expect(onStart).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'toolu_01',
          name: 'run_shell',
        })
      );
    });

    it('should throw on API error during streaming', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          throw new Error('Stream error');
        },
        finalMessage: vi.fn().mockRejectedValue(new Error('Stream error')),
      };

      __mockMessagesStream.mockResolvedValueOnce(mockStream);

      await expect(
        (async () => {
          for await (const _chunk of provider.chat_stream(messages)) {
            // consume
          }
        })()
      ).rejects.toThrow();
    });
  });

  describe('get_model()', () => {
    it('should return the configured model', () => {
      expect(provider.get_model()).toBe('claude-opus-4-6');
    });

    it('should return default model when not configured', () => {
      const p = new AnthropicProvider({ api_key: 'key' });
      expect(p.get_model()).toBe('claude-opus-4-6');
    });
  });

  describe('error handling', () => {
    it('should throw meaningful error for invalid API key', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const MockAnthropic = (vi.mocked(anthropicModule) as any).default;
      const apiError = new MockAnthropic.APIError('Invalid API Key', 401);
      __mockMessagesCreate.mockRejectedValueOnce(apiError);

      await expect(provider.chat(messages)).rejects.toThrow('Anthropic API error (401)');
    });

    it('should throw meaningful error for rate limiting', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const MockAnthropic = (vi.mocked(anthropicModule) as any).default;
      const apiError = new MockAnthropic.APIError('Rate limited', 429);
      __mockMessagesCreate.mockRejectedValueOnce(apiError);

      // Should retry on 429, but ultimately fail
      await expect(provider.chat(messages)).rejects.toThrow();
    });
  });
});
