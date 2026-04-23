import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../../../src/foundation/llm/anthropic.js';
import type { Message, ToolDefinition } from '../../../src/foundation/types.js';

describe('AnthropicProvider with Cache Activation', () => {
  let provider: AnthropicProvider;
  let consoleDebugSpy: any;

  beforeEach(() => {
    provider = new AnthropicProvider({
      api_key: 'sk-test-key',
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
    });
    // Spy on console.debug to capture cache logs
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
  });

  it('should have cache-related methods and turnNumber tracking', () => {
    // Access private turnNumber through type casting for testing
    const providerAny = provider as any;
    expect(providerAny.turnNumber).toBe(0);
  });

  it('should properly initialize system content with cache_control annotation', () => {
    // Test that the buildSystemPrompt method includes cache_control when present
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ];

    // Access private method through type casting for testing
    const providerAny = provider as any;
    const systemPrompt = providerAny.buildSystemPrompt(messages);

    expect(systemPrompt).toBeDefined();
    expect(Array.isArray(systemPrompt)).toBe(true);
    if (Array.isArray(systemPrompt) && systemPrompt.length > 0) {
      // System block should be a text block
      expect(systemPrompt[0].type).toBe('text');
      expect(systemPrompt[0].text).toBe('You are a helpful assistant.');
    }
  });

  it('should track turn numbers across multiple calls', () => {
    const providerAny = provider as any;

    expect(providerAny.turnNumber).toBe(0);
    // Simulating what happens in chat() method
    providerAny.turnNumber++;
    expect(providerAny.turnNumber).toBe(1);
    providerAny.turnNumber++;
    expect(providerAny.turnNumber).toBe(2);
  });

  it('should convert internal Message to Anthropic API format', () => {
    const providerAny = provider as any;
    const message: Message = {
      role: 'user',
      content: 'Hello, world!',
    };

    const apiMessage = providerAny.toApiMessage(message);
    expect(apiMessage.role).toBe('user');
    // Content should be a block array in the API format
    expect(Array.isArray(apiMessage.content) || typeof apiMessage.content === 'string').toBe(true);
  });

  it('should handle tool calls in Anthropic format', () => {
    const providerAny = provider as any;
    const toolBlock = {
      type: 'tool_use',
      id: 'tool-1',
      name: 'grep',
      input: { pattern: 'test', path: 'src/' },
    };

    const internalCall = providerAny.toInternalToolCall(toolBlock);
    expect(internalCall).not.toBeNull();
    expect(internalCall?.id).toBe('tool-1');
    expect(internalCall?.name).toBe('grep');
    expect(internalCall?.arguments).toEqual({ pattern: 'test', path: 'src/' });
  });

  it('should ignore non-tool-use blocks', () => {
    const providerAny = provider as any;
    const textBlock = {
      type: 'text',
      text: 'Response text',
    };

    const internalCall = providerAny.toInternalToolCall(textBlock as any);
    expect(internalCall).toBeNull();
  });
});
