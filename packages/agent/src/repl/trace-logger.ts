import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolCall, ToolResult } from '../foundation/types.js';

export interface TurnTrace {
  turn_id: string;
  turn_number: number;
  timestamp: number;
  user_input: string;
  model: string;
  assistant_response: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    start_time: number;
    end_time?: number;
    result?: ToolResult;
    duration_ms?: number;
  }>;
  finish_reason: 'stop' | 'tool_use';
  token_estimate?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
  };
  compressed?: boolean;
  error?: string;
}

export class TraceLogger {
  private logsDir: string;
  private sessionLogPath: string;
  private turnBuffer: Map<string, Partial<TurnTrace>> = new Map();
  private turnCounter: number = 0;

  constructor(logsDir: string, sessionId: string) {
    this.logsDir = logsDir;
    this.sessionLogPath = path.join(logsDir, `${sessionId}.jsonl`);
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(this.logsDir, { recursive: true });
      // Create file if not exists
      await fs.appendFile(this.sessionLogPath, '');
    } catch (err) {
      // Silent fail - continue even if logging fails
    }
  }

  /**
   * 开始新 turn
   */
  startTurn(turnId: string, userInput: string, model: string): void {
    this.turnCounter++;
    this.turnBuffer.set(turnId, {
      turn_id: turnId,
      turn_number: this.turnCounter,
      timestamp: Date.now(),
      user_input: userInput,
      model,
      tool_calls: [],
    });
  }

  /**
   * 记录工具调用开始
   */
  recordToolStart(turnId: string, toolCall: ToolCall): void {
    const turn = this.turnBuffer.get(turnId);
    if (!turn) return;
    if (!turn.tool_calls) turn.tool_calls = [];
    turn.tool_calls.push({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      start_time: Date.now(),
    });
  }

  /**
   * 记录工具调用结束
   */
  recordToolEnd(turnId: string, toolCallId: string, result: ToolResult): void {
    const turn = this.turnBuffer.get(turnId);
    if (!turn || !turn.tool_calls) return;

    const toolCall = turn.tool_calls.find(tc => tc.id === toolCallId);
    if (toolCall) {
      toolCall.end_time = Date.now();
      toolCall.result = result;
      toolCall.duration_ms = toolCall.end_time - toolCall.start_time;
    }
  }

  /**
   * 完成 turn，落盘
   */
  async completeTurn(
    turnId: string,
    assistantResponse: string,
    finishReason: 'stop' | 'tool_use',
    tokenEstimate?: { input?: number; output?: number; cache_creation?: number; cache_read?: number }
  ): Promise<void> {
    const turn = this.turnBuffer.get(turnId);
    if (!turn) return;

    const completeTurn: TurnTrace = {
      turn_id: turnId,
      turn_number: turn.turn_number || this.turnCounter,
      timestamp: turn.timestamp || Date.now(),
      user_input: turn.user_input || '',
      model: turn.model || '',
      assistant_response: assistantResponse,
      tool_calls: turn.tool_calls,
      finish_reason: finishReason,
      token_estimate: tokenEstimate
        ? {
            input_tokens: tokenEstimate.input,
            output_tokens: tokenEstimate.output,
            cache_creation_tokens: tokenEstimate.cache_creation,
            cache_read_tokens: tokenEstimate.cache_read,
          }
        : undefined,
    };

    try {
      await fs.appendFile(this.sessionLogPath, JSON.stringify(completeTurn) + '\n');
    } catch (err) {
      // Silent fail - don't break execution
    }
    this.turnBuffer.delete(turnId);
  }

  /**
   * 记录压缩事件
   */
  async recordCompression(turnId: string): Promise<void> {
    const turn = this.turnBuffer.get(turnId);
    if (turn) {
      turn.compressed = true;
    }
  }

  /**
   * 记录错误
   */
  async recordError(turnId: string, error: string): Promise<void> {
    const turn = this.turnBuffer.get(turnId);
    if (turn) {
      turn.error = error;
    }
  }

  /**
   * 查询 trace：获取所有 turn
   */
  async queryAllTurns(): Promise<TurnTrace[]> {
    try {
      const content = await fs.readFile(this.sessionLogPath, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as TurnTrace);
    } catch {
      return [];
    }
  }

  /**
   * 查询特定 turn
   */
  async queryTurn(turnId: string): Promise<TurnTrace | null> {
    const turns = await this.queryAllTurns();
    return turns.find(t => t.turn_id === turnId) ?? null;
  }

  /**
   * 统计 token 使用
   */
  async getTokenStats(): Promise<{
    total_input: number;
    total_output: number;
    total_cache_creation: number;
    total_cache_read: number;
  }> {
    const turns = await this.queryAllTurns();
    return {
      total_input: turns.reduce((sum, t) => sum + (t.token_estimate?.input_tokens || 0), 0),
      total_output: turns.reduce((sum, t) => sum + (t.token_estimate?.output_tokens || 0), 0),
      total_cache_creation: turns.reduce((sum, t) => sum + (t.token_estimate?.cache_creation_tokens || 0), 0),
      total_cache_read: turns.reduce((sum, t) => sum + (t.token_estimate?.cache_read_tokens || 0), 0),
    };
  }

  /**
   * 统计工具调用
   */
  async getToolStats(): Promise<Record<string, { count: number; total_duration_ms: number; avg_duration_ms: number }>> {
    const turns = await this.queryAllTurns();
    const toolStats: Record<string, { count: number; total_duration: number; calls: number[] }> = {};

    for (const turn of turns) {
      if (turn.tool_calls) {
        for (const call of turn.tool_calls) {
          if (!toolStats[call.name]) {
            toolStats[call.name] = { count: 0, total_duration: 0, calls: [] };
          }
          toolStats[call.name].count++;
          if (call.duration_ms) {
            toolStats[call.name].total_duration += call.duration_ms;
            toolStats[call.name].calls.push(call.duration_ms);
          }
        }
      }
    }

    return Object.entries(toolStats).reduce(
      (acc, [tool, stats]) => {
        acc[tool] = {
          count: stats.count,
          total_duration_ms: stats.total_duration,
          avg_duration_ms: stats.total_duration / stats.count,
        };
        return acc;
      },
      {} as Record<string, { count: number; total_duration_ms: number; avg_duration_ms: number }>
    );
  }
}
