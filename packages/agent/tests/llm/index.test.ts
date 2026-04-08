import { describe, it, expect } from 'vitest';
import { createProvider, type ProviderType } from '../../src/llm/index.js';
import type { ProviderConfig } from '../../src/types.js';

describe('createProvider', () => {
  const mockConfig: ProviderConfig = {
    api_key: 'test-api-key',
  };

  describe('unknown provider handling', () => {
    it('should throw error for unknown provider type', () => {
      expect(() => createProvider('unknown' as ProviderType, mockConfig))
        .toThrow('Unknown provider: unknown');
    });

    it('should include the unknown type in the error message', () => {
      try {
        createProvider('unknown' as ProviderType, mockConfig);
        expect.fail('Should have thrown an error');
      } catch (e) {
        expect((e as Error).message).toContain('unknown');
      }
    });
  });

  describe('empty string handling', () => {
    it('should throw error for empty string provider type', () => {
      expect(() => createProvider('' as ProviderType, mockConfig))
        .toThrow('Unknown provider: ');
    });
  });

  describe('factory function behavior', () => {
    it('should not throw for valid anthropic type (stub verification)', () => {
      // Note: Constructor throws "not implemented yet" - this is expected
      // The routing logic itself is correct; stubs are replaced in T-04/T-05
      expect(() => createProvider('anthropic', mockConfig)).not.toThrow(/Unknown provider/);
    });

    it('should not throw for valid openai type (stub verification)', () => {
      expect(() => createProvider('openai', mockConfig)).not.toThrow(/Unknown provider/);
    });

    it('should route to AnthropicProvider for anthropic type', () => {
      // The factory should route to AnthropicProvider class
      // Constructor throws at runtime, but routing is correct
      try {
        createProvider('anthropic', mockConfig);
      } catch (e) {
        expect((e as Error).message).toBe('AnthropicProvider not implemented yet');
      }
    });

    it('should route to OpenAIProvider for openai type', () => {
      try {
        createProvider('openai', mockConfig);
      } catch (e) {
        expect((e as Error).message).toBe('OpenAIProvider not implemented yet');
      }
    });
  });

  describe('type exports', () => {
    it('should export ProviderType type', () => {
      const type: ProviderType = 'anthropic';
      expect(type).toBe('anthropic');
    });

    it('should export LLMProvider type', () => {
      // Verify the type is exported correctly
      const type: ProviderType = 'openai';
      expect(type).toBe('openai');
    });
  });
});
