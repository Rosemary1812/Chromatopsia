import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { AgentRuntimeResult } from '@chromatopsia/agent';
import { ApprovalController } from './approval-controller.js';
import { Header } from './components/header.js';
import { Transcript } from './components/transcript.js';
import { InputBox } from './components/input-box.js';
import { ApprovalPrompt } from './components/approval-prompt.js';
import { Footer } from './components/footer.js';
import { useTuiStore } from './hooks.js';
import type { TuiStore } from './store.js';
import { getTheme, type TuiThemePalette } from './types.js';
import { buildDynamicSlashCommands, mergeSlashCommands } from './commands.js';

type AppProps = {
  store: TuiStore;
  runtime: AgentRuntimeResult;
  approvalController: ApprovalController;
  model: string;
  cwd: string;
};

export function App({ store, runtime, approvalController, model, cwd }: AppProps) {
  const { exit } = useApp();
  const state = useTuiStore(store, (snapshot) => snapshot);
  const theme = getTheme(state.themeMode);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [shimmerFrame, setShimmerFrame] = useState(0);
  const mode = state.inputMode === 'approval' ? 'approval' : state.streaming ? 'working' : 'idle';

  const refreshAvailableCommands = useCallback(() => {
    store.setAvailableCommands(
      mergeSlashCommands(
        buildDynamicSlashCommands(runtime.list_slash_commands(), runtime.list_draft_skills()),
      ),
    );
  }, [runtime, store]);

  const handleSubmit = useCallback(async (nextValue?: string) => {
    const input = (nextValue ?? state.pendingInput).trim();
    if (!input || state.inputMode !== 'normal') return;
    const result = await store.executeInput(input);
    if (!result.handled) {
      store.setPendingInput('');
      await runtime.handle_user_input(input);
    }
    refreshAvailableCommands();
  }, [refreshAvailableCommands, runtime, state.inputMode, state.pendingInput, store]);

  const handleApprove = useCallback(() => {
    approvalController.respond('approve');
  }, [approvalController]);

  const handleReject = useCallback(() => {
    approvalController.respond('reject');
  }, [approvalController]);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  useEffect(() => {
    refreshAvailableCommands();
  }, [refreshAvailableCommands]);

  const latestTool = useMemo(
    () => Object.values(state.toolActivity).sort((left, right) => right.timestamp - left.timestamp)[0],
    [state.toolActivity],
  );
  const spinnerFrames = ['·', '✢', '*', '✶', '✻', '✽', '✻', '✶', '*', '✢'];
  const loadingMessage = 'Working on it...';

  useEffect(() => {
    if (!state.streaming) return;
    const timer = setInterval(() => {
      setSpinnerFrame((frame) => (frame + 1) % spinnerFrames.length);
    }, 120);
    return () => clearInterval(timer);
  }, [spinnerFrames.length, state.streaming]);

  useEffect(() => {
    if (!state.streaming) return;
    const timer = setInterval(() => {
      setShimmerFrame((frame) => (frame + 1) % (loadingMessage.length + 3));
    }, 100);
    return () => clearInterval(timer);
  }, [loadingMessage.length, state.streaming]);

  return (
    <Box flexDirection="column" width="100%">
      <Header model={model} cwd={cwd} mode={mode} version="1.0.0" theme={theme} />
      <Box flexDirection="column" marginTop={1} rowGap={1}>
        {state.transcript.length > 0 ? <Transcript items={state.transcript} mode={mode} activeToolLabel={null} theme={theme} /> : null}
        {state.streaming ? (
          <StreamingIndicator
            spinner={spinnerFrames[spinnerFrame]}
            message={loadingMessage}
            shimmerFrame={shimmerFrame}
            nextTodo={latestTool?.summary ?? null}
            theme={theme}
          />
        ) : null}
        {state.inputMode === 'approval' && state.approvalRequest ? (
          <ApprovalPrompt request={state.approvalRequest} onApprove={handleApprove} onReject={handleReject} theme={theme} />
        ) : (
          <InputBox
            value={state.pendingInput}
            disabled={false}
            commands={state.availableCommands}
            onChange={(value) => store.setPendingInput(value)}
            onSubmit={(nextValue) => {
              void handleSubmit(nextValue);
            }}
            theme={theme}
          />
        )}
        <Footer model={model} tokenCount={0} theme={theme} />
      </Box>
    </Box>
  );
}

function StreamingIndicator(
  {
    spinner,
    message,
    shimmerFrame,
    nextTodo,
    theme,
  }: {
    spinner: string;
    message: string;
    shimmerFrame: number;
    nextTodo: string | null;
    theme: TuiThemePalette;
  },
) {
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Text color={theme.primary}>{spinner}</Text>
        <ShimmerText text={message} frame={shimmerFrame} width={3} theme={theme} />
      </Box>
      {nextTodo ? <Text color={theme.textDim}>{`Next: ${nextTodo}`}</Text> : null}
    </Box>
  );
}

function ShimmerText({
  text,
  frame,
  width,
  theme,
}: {
  text: string;
  frame: number;
  width: number;
  theme: TuiThemePalette;
}) {
  return (
    <Text>
      {text.split('').map((char, index) => {
        const inWindow = index >= frame && index < frame + width;
        return (
          <Text key={`${char}-${index}`} color={inWindow ? theme.highlightedText : theme.textMuted} bold={inWindow}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}
