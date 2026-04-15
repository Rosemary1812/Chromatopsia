import type { LLMProvider, Message, MemoryType } from '../foundation/types.js';

export interface MemoryDecision {
  should_write: boolean;
  type?: MemoryType;
  name?: string;
  description?: string;
  entry?: string;
  confidence?: number;
  reason?: string;
}

function extractJson(content: string): MemoryDecision | null {
  try {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = jsonMatch ? jsonMatch[1].trim() : content.trim();
    const obj = JSON.parse(raw) as MemoryDecision;
    if (!obj || typeof obj.should_write !== 'boolean') {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

export function buildMemoryDecisionPrompt(userInput: string, recentMessages: Message[]): string {
  const recent = recentMessages
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  return [
    '你是 Memory 决策器。请判断下面的用户输入是否应该写入持久 Memory。',
    '',
    'Memory 类型只有四种：user / feedback / project / reference。',
    '',
    '应写入：',
    '1. 用户明确要求记住',
    '2. 用户纠正了助手行为（下次应该怎么做）',
    '3. 可长期复用的稳定偏好或事实',
    '',
    '不应写入：',
    '1. 一次性上下文',
    '2. Git 临时状态（如 git log）',
    '3. 可以通过读代码直接得到的信息',
    '',
    '请仅输出 JSON，字段：',
    '{',
    '  "should_write": boolean,',
    '  "type": "user|feedback|project|reference",',
    '  "name": "topic-name-kebab-case",',
    '  "description": "一句话描述",',
    '  "entry": "要追加写入的一条记忆文本",',
    '  "confidence": 0-1,',
    '  "reason": "简短理由"',
    '}',
    '',
    '若不该写入，输出：{"should_write": false, "reason": "..."}',
    '',
    '用户输入：',
    userInput,
    '',
    '最近对话：',
    recent || '(empty)',
  ].join('\n');
}

export async function decideMemoryWrite(
  provider: LLMProvider,
  userInput: string,
  recentMessages: Message[],
): Promise<MemoryDecision> {
  const prompt = buildMemoryDecisionPrompt(userInput, recentMessages);
  const response = await provider.chat([{ role: 'user', content: prompt }]);
  const parsed = extractJson(response.content);
  if (!parsed) {
    return { should_write: false, reason: 'failed_to_parse_decision' };
  }
  return parsed;
}

