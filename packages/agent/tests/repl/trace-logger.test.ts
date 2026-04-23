import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TraceLogger } from '../../src/repl/trace-logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TraceLogger', () => {
  let tempDir: string;
  let traceLogger: TraceLogger;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-test-'));
    traceLogger = new TraceLogger(tempDir, 'test-session');
    await traceLogger.init();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should initialize successfully', async () => {
    const logFile = path.join(tempDir, 'test-session.jsonl');
    expect(fs.existsSync(logFile)).toBe(true);
  });

  it('should record a complete turn with tool calls', async () => {
    const turnId = 'turn-1';
    traceLogger.startTurn(turnId, 'fix the bug', 'claude-3-5-sonnet');

    traceLogger.recordToolStart(turnId, {
      id: 'tool-1',
      name: 'read',
      arguments: { file_path: 'src/index.ts' },
    });

    traceLogger.recordToolEnd(turnId, 'tool-1', {
      tool_call_id: 'tool-1',
      output: 'file content',
      success: true,
    });

    await traceLogger.completeTurn(turnId, 'I found the issue', 'tool_use', { input: 100, output: 50 });

    const turn = await traceLogger.queryTurn(turnId);
    expect(turn).toBeDefined();
    expect(turn?.turn_id).toBe('turn-1');
    expect(turn?.user_input).toBe('fix the bug');
    expect(turn?.assistant_response).toBe('I found the issue');
    expect(turn?.tool_calls).toHaveLength(1);
    expect(turn?.tool_calls![0].name).toBe('read');
    expect(turn?.token_estimate?.input_tokens).toBe(100);
    expect(turn?.token_estimate?.output_tokens).toBe(50);
  });

  it('should calculate token stats correctly', async () => {
    traceLogger.startTurn('turn-1', 'task 1', 'claude');
    await traceLogger.completeTurn('turn-1', 'response 1', 'stop', {
      input: 100,
      output: 50,
    });

    traceLogger.startTurn('turn-2', 'task 2', 'claude');
    await traceLogger.completeTurn('turn-2', 'response 2', 'stop', {
      input: 80,
      output: 40,
    });

    const stats = await traceLogger.getTokenStats();
    expect(stats.total_input).toBe(180);
    expect(stats.total_output).toBe(90);
  });

  it('should calculate tool stats correctly', async () => {
    traceLogger.startTurn('turn-1', 'task 1', 'claude');
    traceLogger.recordToolStart('turn-1', {
      id: 'tool-1',
      name: 'read',
      arguments: { file: 'test.ts' },
    });
    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 10));
    traceLogger.recordToolEnd('turn-1', 'tool-1', {
      tool_call_id: 'tool-1',
      output: 'content',
      success: true,
    });
    await traceLogger.completeTurn('turn-1', 'response', 'tool_use');

    traceLogger.startTurn('turn-2', 'task 2', 'claude');
    traceLogger.recordToolStart('turn-2', {
      id: 'tool-2',
      name: 'read',
      arguments: { file: 'test2.ts' },
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    traceLogger.recordToolEnd('turn-2', 'tool-2', {
      tool_call_id: 'tool-2',
      output: 'content',
      success: true,
    });
    await traceLogger.completeTurn('turn-2', 'response', 'tool_use');

    const toolStats = await traceLogger.getToolStats();
    expect(toolStats['read']).toBeDefined();
    expect(toolStats['read'].count).toBe(2);
    expect(toolStats['read'].total_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should handle cache stats with cache_read_tokens', async () => {
    traceLogger.startTurn('turn-1', 'task 1', 'claude');
    await traceLogger.completeTurn('turn-1', 'response 1', 'stop', {
      input: 100,
      output: 50,
      cache_creation: 200,
      cache_read: 150,
    });

    const stats = await traceLogger.getTokenStats();
    expect(stats.total_cache_creation).toBe(200);
    expect(stats.total_cache_read).toBe(150);
  });

  it('should return empty array when no traces exist', async () => {
    const turns = await traceLogger.queryAllTurns();
    expect(turns).toEqual([]);
  });

  it('should record turn numbers correctly', async () => {
    traceLogger.startTurn('turn-1', 'first', 'claude');
    await traceLogger.completeTurn('turn-1', 'response', 'stop');

    traceLogger.startTurn('turn-2', 'second', 'claude');
    await traceLogger.completeTurn('turn-2', 'response', 'stop');

    const turn1 = await traceLogger.queryTurn('turn-1');
    const turn2 = await traceLogger.queryTurn('turn-2');

    expect(turn1?.turn_number).toBe(1);
    expect(turn2?.turn_number).toBe(2);
  });
});
