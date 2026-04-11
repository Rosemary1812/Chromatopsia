#!/usr/bin/env node
/**
 * Chromatopsia CLI — 独立程序，调用 agent 作为库
 *
 * 用法：
 *   pnpm dev              # 使用 config.yaml 配置
 *   DEBUG=1 pnpm dev      # 开启 debug 输出
 *   ANTHROPIC_API_KEY=xxx pnpm dev
 */

import { run_repl, load_config } from '@chromatopsia/agent';
import { resolve } from 'node:path';
import * as readline from 'node:readline';

async function main() {
  // CLI 跑在 packages/cli/，config 在 packages/agent/config.yaml
  const configPath = resolve(import.meta.dirname, '../../agent/config.yaml');
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const config = await load_config(configPath);

  // Banner — CLI 完全自己控制渲染
  console.log('╔══════════════════════════════════════╗');
  console.log('║       Chromatopsia Agent v0.1.0      ║');
  console.log('╚══════════════════════════════════════╝');
  const model = config.provider === 'anthropic'
    ? config.anthropic?.model
    : config.openai?.model;
  console.log(`Provider:  ${config.provider}`);
  console.log(`Model:    ${model ?? 'default'}`);
  console.log(`Working:  ${repoRoot}`);
  console.log();

  const anthropicConfig = config.anthropic;
  const openaiConfig = config.openai;
  const isDebug = !!process.env.DEBUG;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  let streamBuffer = '';
  let flushTimer: NodeJS.Timeout | null = null;
  let streamedSinceLastTurn = false;
  const FLUSH_THRESHOLD = 48;
  const FLUSH_DELAY_MS = 24;

  function redrawPromptLine() {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`> ${rl.line}`);
    readline.cursorTo(process.stdout, 2 + rl.cursor);
  }

  function printEventLine(line: string, isError = false) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    if (isError) {
      console.error(line);
    } else {
      console.log(line);
    }
    redrawPromptLine();
  }

  function flushStreamBuffer(force = false) {
    if (!streamBuffer) return;
    if (!force && streamBuffer.length < FLUSH_THRESHOLD && !streamBuffer.includes('\n')) return;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const out = streamBuffer;
    streamBuffer = '';
    streamedSinceLastTurn = true;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(out);
    if (!out.endsWith('\n')) {
      process.stdout.write('\n');
    }
    redrawPromptLine();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushStreamBuffer(true);
    }, FLUSH_DELAY_MS);
  }

  const { start } = await run_repl({
    working_dir: repoRoot,
    provider: config.provider,
    config: {
      api_key: config.provider === 'anthropic'
        ? (anthropicConfig?.api_key ?? '')
        : (openaiConfig?.api_key ?? ''),
      model: config.provider === 'anthropic'
        ? anthropicConfig?.model
        : openaiConfig?.model,
      max_tokens: config.provider === 'anthropic'
        ? anthropicConfig?.max_tokens
        : undefined,
      base_url: config.provider === 'anthropic'
        ? anthropicConfig?.base_url
        : openaiConfig?.base_url,
    },
    app_config: config,
    readline_interface: rl,

    // I/O 完全由 CLI 接管
    logLevel: isDebug ? 'debug' : 'error',
    events: {
      // LLM 流式输出：缓冲后刷新，避免打断 readline 当前输入行
      onStreamChunk: (chunk) => {
        streamBuffer += chunk;
        flushStreamBuffer(false);
        scheduleFlush();
      },

      // 本轮对话结束：打印最终回复
      onTurnComplete: (content, toolCalls) => {
        flushStreamBuffer(true);
        const text = content?.trim();
        if (text && !streamedSinceLastTurn) {
          printEventLine(text);
        }
        if (toolCalls?.length) {
          printEventLine(`  (tools used: ${toolCalls.map((t) => t.name).join(', ')})`);
        }
        streamedSinceLastTurn = false;
      },

      // 工具批次结束：打印摘要
      onToolBatchEnd: (toolCalls, _results) => {
        flushStreamBuffer(true);
        printEventLine(`  → ${toolCalls.length} tool(s) executed`);
      },

      // 工具结束：显示单个结果
      onToolEnd: (toolCall, result) => {
        flushStreamBuffer(true);
        const icon = result.success ? '✓' : '✗';
        printEventLine(`  ${icon} ${toolCall.name}`);
      },

      // 通知：青色高亮
      onNotification: (msg) => {
        flushStreamBuffer(true);
        printEventLine(`\x1b[36m[Skill]\x1b[0m ${msg}`);
      },

      // 错误：红色
      onError: (msg) => {
        flushStreamBuffer(true);
        printEventLine(`\x1b[31m[Error]\x1b[0m ${msg}`, true);
      },

      // 调试：灰色（仅 DEBUG=1 时显示）
      onDebug: (msg) => {
        flushStreamBuffer(true);
        printEventLine(`\x1b[90m${msg}\x1b[0m`, true);
      },
    },
  });

  await start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
