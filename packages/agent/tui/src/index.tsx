#!/usr/bin/env node

import { render } from 'ink';
import { create_agent_runtime, load_config, type RuntimeSink } from '@chromatopsia/agent';
import { resolve } from 'node:path';
import { ApprovalController } from './approval-controller.js';
import { App } from './app.js';
import { TuiStore } from './store.js';

async function main() {
  const configPath = resolve(import.meta.dirname, '../../config.yaml');
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const config = await load_config(configPath);

  const anthropicConfig = config.anthropic;
  const openaiConfig = config.openai;
  const approvalController = new ApprovalController();

  let store: TuiStore;

  const runtimeSink: RuntimeSink = {
    emit(event) {
      store.handleRuntimeEvent(event);
    },
    requestApproval(request) {
      return approvalController.waitForResponse(request);
    },
  };

  const runtime = await create_agent_runtime({
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
    runtime: runtimeSink,
    logLevel: process.env.DEBUG ? 'debug' : 'error',
    agentId: 'main',
    agentRole: 'main',
  });

  store = new TuiStore({
    clearConversation: () => {
      runtime.clear_conversation();
    },
    exit: () => {
      process.exit(0);
    },
  });

  const model = config.provider === 'anthropic'
    ? anthropicConfig?.model ?? 'default'
    : openaiConfig?.model ?? 'default';

  render(
    <App
      store={store}
      runtime={runtime}
      approvalController={approvalController}
      model={model}
      cwd={repoRoot}
    />,
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
