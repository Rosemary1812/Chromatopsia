import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import type { SlashCommand, TuiThemePalette } from '../types.js';

type InputBoxProps = {
  value: string;
  disabled?: boolean;
  commands: SlashCommand[];
  onChange: (value: string) => void;
  onSubmit: (nextValue?: string) => void;
  theme: TuiThemePalette;
};

function buildVisibleCommands(input: string, commands: SlashCommand[]) {
  const query = input.startsWith('/') ? input.slice(1).trim().toLowerCase() : '';
  if (!query) {
    return commands.slice(0, 8);
  }
  return commands
    .filter((command) => {
      const normalized = command.input.toLowerCase();
      return normalized.includes(`/${query}`) || normalized.includes(query);
    })
    .slice(0, 8);
}

function HighlightedInput({ value, theme }: { value: string; theme: TuiThemePalette }) {
  if (!value) {
    const placeholder = 'Type a message or / for commands';
    return (
      <Text color={theme.textDim}>
        <Text inverse>{placeholder[0]}</Text>
        {placeholder.slice(1)}
      </Text>
    );
  }

  const highlightLength = value.startsWith('/') ? Math.max(1, value.split(/\s/, 1)[0].length) : 0;
  const before = highlightLength > 0 ? value.slice(0, highlightLength) : '';
  const after = value.slice(highlightLength);

  return (
    <Text color={theme.textPrimary}>
      {before ? (
        <Text bold inverse color={theme.primary}>
          {before}
        </Text>
      ) : null}
      {after}
      <Text inverse> </Text>
    </Text>
  );
}

export function InputBox({ value, disabled = false, commands, onChange, onSubmit, theme }: InputBoxProps) {
  const visibleCommands = buildVisibleCommands(value, commands);
  const pickerVisible = value.startsWith('/');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [value]);

  useInput((input, key) => {
    if (disabled) return;

    if (pickerVisible && visibleCommands.length > 0) {
      if (key.upArrow) {
        setSelectedIndex((index) => (index - 1 + visibleCommands.length) % visibleCommands.length);
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((index) => (index + 1) % visibleCommands.length);
        return;
      }

      if (key.escape) {
        onChange('');
        return;
      }
    }

      if (key.return) {
        if (pickerVisible && visibleCommands[selectedIndex]) {
        onSubmit(visibleCommands[selectedIndex].input);
          return;
        }
      onSubmit();
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.tab) {
      return;
    }

    if (input) {
      onChange(`${value}${input}`);
    }
  });

  return (
    <Box flexDirection="column" rowGap={1}>
      {pickerVisible ? (
        <Box flexDirection="column" borderStyle="single" borderColor={theme.surfaceBorder} paddingX={1}>
          <Text bold color={theme.primary}>Commands</Text>
          {visibleCommands.map((command, index) => (
            <Box key={command.input}>
              <Text bold color={index === selectedIndex ? theme.highlightedText : theme.textDim}>
                {index === selectedIndex ? '❯ ' : '  '}
              </Text>
              <Text bold color={index === selectedIndex ? theme.highlightedText : theme.textPrimary}>
                {command.input}
              </Text>
              <Text color={theme.textDim}>{` ${command.description}`}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      <Box
        borderStyle="single"
        borderTop
        borderBottom
        borderLeft={false}
        borderRight={false}
        borderColor={disabled ? theme.textDim : theme.surfaceBorder}
        columnGap={1}
      >
        <Text color={theme.textPrimary}>{'❯'}</Text>
        <HighlightedInput value={value} theme={theme} />
      </Box>
    </Box>
  );
}
