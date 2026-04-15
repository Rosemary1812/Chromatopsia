import { describe, it, expect } from 'vitest';
import type { LLMProvider } from '../../src/foundation/types.js';
import { buildMemoryDecisionPrompt, decideMemoryWrite } from '../../src/memory/decider.js';

const provider: LLMProvider = {
  name: 'mock',
  chat: async () => ({
    content: JSON.stringify({
      should_write: true,
      type: 'feedback',
      name: 'feedback-style',
      description: '用户纠正了输出风格',
      entry: '下次先给结论',
      confidence: 0.9,
    }),
    finish_reason: 'stop',
  }),
  chat_stream: async function* () {
    yield '';
    return { content: '', finish_reason: 'stop' };
  },
  get_model: () => 'mock',
};

describe('memory/decider', () => {
  it('builds decision prompt with boundaries', () => {
    const prompt = buildMemoryDecisionPrompt('请记住我偏好简洁输出', []);
    expect(prompt).toContain('应写入');
    expect(prompt).toContain('不应写入');
    expect(prompt).toContain('Git 临时状态');
  });

  it('parses provider decision json', async () => {
    const decision = await decideMemoryWrite(provider, '你应该先给结论', []);
    expect(decision.should_write).toBe(true);
    expect(decision.type).toBe('feedback');
  });
});

