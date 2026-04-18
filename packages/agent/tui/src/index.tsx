#!/usr/bin/env node

import { render } from 'ink';
import {
  create_agent_runtime,
  load_config,
  resolveConfigPath,
  type RuntimeSink,
} from '@chromatopsia/agent';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ApprovalController } from './approval-controller.js';
import { App } from './app.js';
import { TuiStore } from './store.js';
import { resolveThemeMode } from './types.js';

export interface RunTuiOptions {
  workingDir?: string;
  configPath?: string;
  debug?: boolean;
  exit?: () => void;
}

function resolveProviderView(config: Awaited<ReturnType<typeof load_config>>) {
  const providerConfig = config[config.provider];
  return {
    api_key: providerConfig?.api_key ?? '',
    base_url: providerConfig?.base_url,
    model: providerConfig?.model,
    max_tokens: providerConfig?.max_tokens,
  };
}

export async function runTui(options: RunTuiOptions = {}): Promise<void> {
  const workingDir = resolve(options.workingDir ?? process.cwd());
  const resolvedConfig = resolveConfigPath({
    workingDir,
    explicitPath: options.configPath,
  });

  if (!resolvedConfig.path) {
    throw new Error('Config file not found. Run `chroma` in an interactive terminal to complete onboarding.');
  }

  const config = await load_config(resolvedConfig.path);
  const providerConfig = resolveProviderView(config);
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
    working_dir: workingDir,
    config_path: resolvedConfig.path,
    provider: config.provider,
    config: providerConfig,
    app_config: config,
    runtime: runtimeSink,
    logLevel: options.debug || process.env.DEBUG ? 'debug' : 'error',
    agentId: 'main',
    agentRole: 'main',
  });

  store = new TuiStore({
    initialState: {
      themeMode: resolveThemeMode(config.tui?.theme),
    },
    clearConversation: () => {
      runtime.clear_conversation();
    },
    exit: options.exit ?? (() => {
      process.exit(0);
    }),
  });

  const startupSkillMessage = runtime.get_skill_load_message();
  if (startupSkillMessage) {
    store.handleRuntimeEvent({
      type: 'notification',
      message: startupSkillMessage,
      agentId: 'main',
      agentRole: 'main',
      timestamp: Date.now(),
    });
  }

  render(
    <App
      store={store}
      runtime={runtime}
      approvalController={approvalController}
      model={providerConfig.model ?? 'default'}
      cwd={workingDir}
    />,
  );
}

async function main() {
  await runTui({
    workingDir: resolve(import.meta.dirname, '../../..'),
    configPath: resolve(import.meta.dirname, '../../config.yaml'),
  });
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath === modulePath) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
