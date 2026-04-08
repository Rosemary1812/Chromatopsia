import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the openai module before importing OpenAIProvider
const mockCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

import { OpenAIProvider } from '../../src/llm/openai.js';
import type { Message, ToolDefinition, ProviderConfig } from '../../src/types.js';

describe('OpenAIProvider', () => {
  const baseConfig: ProviderConfig = {
    api_key: 'test-key',
    model: 'gpt-4o',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create provider with default model', () => {
      const provider = new OpenAIProvider({ api_key: 'test' });
      expect(provider.name).toBe('openai');
      expect(provider.get_model()).toBe('gpt-4o');
    });

    it('should create provider with custom model', () => {
      const provider = new OpenAIProvider({ api_key: 'test', model: 'gpt-4-turbo' });
      expect(provider.get_model()).toBe('gpt-4-turbo');
    });

    it('should use gpt-4o as default model if not specified', () => {
      const provider = new OpenAIProvider({ api_key: 'test' });
      expect(provider.get_model()).toBe('gpt-4o');
    });
  });

  describe('get_model', () => {
    it('should return the configured model', () => {
      const provider = new OpenAIProvider({ api_key: 'test', model: 'gpt-4o-mini' });
      expect(provider.get_model()).toBe('gpt-4o-mini');
    });
  });

  describe('chat()', () => {
    it('should send messages to OpenAI API', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Hi there!', role: 'assistant' },
          finish_reason: 'stop',
        }],
      });

      const result = await provider.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: undefined,
        tool_choice: 'auto',
      });
      expect(result.content).toBe('Hi there!');
      expect(result.finish_reason).toBe('stop');
    });

    it('should handle tool_calls in response', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [{ role: 'user', content: 'Run ls' }];

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '',
            role: 'assistant',
            tool_calls: [{
              id: 'tc_123',
              type: 'function',
              function: { name: 'run_shell', arguments: '{"command":"ls"}' },
            }],
          },
          finish_reason: 'tool_use',
        }],
      });

      const result = await provider.chat(messages);

      expect(result.content).toBe('');
      expect(result.finish_reason).toBe('tool_use');
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls![0]).toEqual({
        id: 'tc_123',
        name: 'run_shell',
        arguments: { command: 'ls' },
      });
    });

    it('should pass tools to OpenAI API', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [{ role: 'user', content: 'Run ls' }];
      const tools: ToolDefinition[] = [{
        name: 'run_shell',
        description: 'Run a shell command',
        input_schema: { type: 'object', properties: { command: { type: 'string' } } },
        handler: vi.fn() as any,
      }];

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Done', role: 'assistant' },
          finish_reason: 'stop',
        }],
      });

      await provider.chat(messages, tools);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [{
            type: 'function',
            function: {
              name: 'run_shell',
              description: 'Run a shell command',
              parameters: { type: 'object', properties: { command: { type: 'string' } } },
            },
          }],
        }),
      );
    });

    it('should convert tool role messages correctly', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [
        { role: 'user', content: 'Run ls' },
        {
          role: 'tool',
          content: 'file1.txt\nfile2.txt',
          tool_results: [{ tool_call_id: 'tc_123', output: 'file1.txt\nfile2.txt', success: true }],
        },
      ];

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'I see 2 files', role: 'assistant' },
          finish_reason: 'stop',
        }],
      });

      await provider.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'user', content: 'Run ls' },
            { role: 'tool', tool_call_id: 'tc_123', content: 'file1.txt\nfile2.txt' },
          ]),
        }),
      );
    });

    it('should convert assistant messages with tool_calls correctly', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [
        {
          role: 'assistant',
          content: 'Running command',
          tool_calls: [{ id: 'tc_abc', name: 'run_shell', arguments: { command: 'pwd' } }],
        },
      ];

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Done', role: 'assistant' },
          finish_reason: 'stop',
        }],
      });

      await provider.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{
            role: 'assistant',
            content: 'Running command',
            tool_calls: [{
              id: 'tc_abc',
              type: 'function',
              function: { name: 'run_shell', arguments: '{"command":"pwd"}' },
            }],
          }],
        }),
      );
    });

    it('should handle empty choices', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      mockCreate.mockResolvedValueOnce({ choices: [] });

      const result = await provider.chat(messages);

      expect(result.content).toBe('');
      expect(result.finish_reason).toBe('stop');
    });

    it('should handle malformed JSON in tool arguments', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [{ role: 'user', content: 'Run' }];

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '',
            role: 'assistant',
            tool_calls: [{
              id: 'tc_bad',
              type: 'function',
              function: { name: 'run_shell', arguments: 'not-valid-json' },
            }],
          },
          finish_reason: 'tool_use',
        }],
      });

      const result = await provider.chat(messages);

      expect(result.tool_calls![0].arguments).toEqual({});
    });

    it('should handle stop finish_reason without tool_calls', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Hello back!', role: 'assistant' },
          finish_reason: 'stop',
        }],
      });

      const result = await provider.chat(messages);

      expect(result.content).toBe('Hello back!');
      expect(result.finish_reason).toBe('stop');
      expect(result.tool_calls).toBeUndefined();
    });
  });

  describe('Function Calling format conversion', () => {
    it('should convert internal ToolDefinition to OpenAI function format', async () => {
      const provider = new OpenAIProvider(baseConfig);
      const messages: Message[] = [{ role: 'user', content: 'What files?' }];
      const tools: ToolDefinition[] = [{
        name: 'Glob',
        description: 'Find files matching pattern',
        input_schema: {
          type: 'object',
          properties: { pattern: { type: 'string' } },
          required: ['pattern'],
        },
        handler: vi.fn() as any,
      }];

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Found 3 files', role: 'assistant' },
          finish_reason: 'stop',
        }],
      });

      await provider.chat(messages, tools);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [{
            type: 'function',
            function: {
              name: 'Glob',
              description: 'Find files matching pattern',
              parameters: {
                type: 'object',
                properties: { pattern: { type: 'string' } },
                required: ['pattern'],
              },
            },
          }],
        }),
      );
    });
  });
});
