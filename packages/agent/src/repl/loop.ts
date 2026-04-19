// T-24: repl/loop.ts — REPL 主循环
// 在线回路只服务用户：Skill 前置匹配 + LLM/tool 执行。
// 自学习由离线 LearningWorker 处理，不阻塞主对话。

import * as readline from 'node:readline';
import { createRuntimeEvent, createRuntimeSinkFromAgentEvents } from './runtime.js';
import { create_agent_runtime_impl } from './runtime-factory.js';
import type { ReplOptions, RunReplResult, AgentRuntimeOptions, AgentRuntimeResult } from './loop-types.js';

export type { ReplOptions, RunReplResult, AgentRuntimeOptions, AgentRuntimeResult } from './loop-types.js';

export async function create_agent_runtime(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
  return create_agent_runtime_impl(options);
}

/**
 * Run the REPL loop.
 *
 * @param options REPL configuration options
 * @returns RunReplResult with handle_user_input (for testing) and start() to begin
 */
export async function run_repl(options: ReplOptions): Promise<RunReplResult> {
  const {
    working_dir,
    readline_interface: customRl,
    on_exit,
    events = {},
    provider,
    config,
    app_config,
    slash_handler,
    logLevel,
    agentId,
    agentRole,
  } = options;

  const runtime = createRuntimeSinkFromAgentEvents(events);
  const agentRuntime = await create_agent_runtime({
    working_dir,
    provider,
    config,
    app_config,
    slash_handler,
    runtime,
    logLevel,
    agentId,
    agentRole,
  });

  // P0-1: 显示会话恢复状态
  if (agentRuntime.sessionRecovered) {
    runtime.emit(createRuntimeEvent({
      type: 'notification',
      message: `✓ Session recovered: ${agentRuntime.sessionId}`
    }, {
      agentId: agentId ?? 'main',
      agentRole: agentRole ?? 'main',
    }));
  } else {
    runtime.emit(createRuntimeEvent({
      type: 'notification',
      message: `✓ New session: ${agentRuntime.sessionId}`
    }, {
      agentId: agentId ?? 'main',
      agentRole: agentRole ?? 'main',
    }));
  }

  let rl: readline.Interface | null = customRl ?? null;

  function make_rl_promise(): Promise<string> {
    return new Promise<string>((resolve) => {
      if (!rl) {
        resolve('');
        return;
      }
      rl.question('> ', (answer) => {
        resolve(answer ?? '');
      });
    });
  }

  let running = true;
  let turnPromise: Promise<void> = Promise.resolve();

  async function main_loop(): Promise<never> {
    const isDebug = logLevel === 'debug';
    if (isDebug) {
      runtime.emit(createRuntimeEvent({ type: 'debug', message: 'main_loop started' }, {
        agentId: agentId ?? 'main',
        agentRole: agentRole ?? 'main',
      }));
    }

    if (!rl) {
      if (!process.stdin.isTTY) {
        runtime.emit(createRuntimeEvent({ type: 'error', message: 'REPL requires an interactive terminal (TTY).' }, {
          agentId: agentId ?? 'main',
          agentRole: agentRole ?? 'main',
        }));
        process.exit(1);
      }

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> ',
      });
      rl.on('close', () => {
        running = false;
        on_exit?.();
      });
    }

    runtime.emit(createRuntimeEvent({ type: 'notification', message: 'REPL ready. Type /help for commands.' }, {
      agentId: agentId ?? 'main',
      agentRole: agentRole ?? 'main',
    }));

    while (running) {
      try {
        const input_value = await make_rl_promise();
        turnPromise = turnPromise.then(() => agentRuntime.handle_user_input(input_value));
        await turnPromise;
      } catch {
        break;
      }
    }

    on_exit?.();
    process.exit(0);
  }

  return {
    handle_user_input: agentRuntime.handle_user_input,
    clear_conversation: agentRuntime.clear_conversation,
    start: main_loop,
  };
}
