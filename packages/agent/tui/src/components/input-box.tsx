import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { listBuiltinCommands } from '../commands.js';
import { TUI_THEME } from '../types.js';

type InputBoxProps = {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: (nextValue?: string) => void;
};

function buildVisibleCommands(input: string) {
  const commands = listBuiltinCommands();
  const query = input.startsWith('/') ? input.slice(1).trim().toLowerCase() : '';
  return commands.filter((command) => command.name.includes(query)).slice(0, 5);
}

function HighlightedInput({ value }: { value: string }) {
  if (!value) {
    const placeholder = 'Type a message or / for commands';
    return (
      <Text color={TUI_THEME.textDim}>
        <Text inverse>{placeholder[0]}</Text>
        {placeholder.slice(1)}
      </Text>
    );
  }

  const highlightLength = value.startsWith('/') ? Math.max(1, value.split(/\s/, 1)[0].length) : 0;
  const before = highlightLength > 0 ? value.slice(0, highlightLength) : '';
  const after = value.slice(highlightLength);

  return (
    <Text color={TUI_THEME.textPrimary}>
      {before ? (
        <Text bold inverse color={TUI_THEME.primary}>
          {before}
        </Text>
      ) : null}
      {after}
      <Text inverse> </Text>
    </Text>
  );
}

export function InputBox({ value, disabled = false, onChange, onSubmit }: InputBoxProps) {
  const visibleCommands = buildVisibleCommands(value);
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
        onSubmit(`/${visibleCommands[selectedIndex].name}`);
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
        <Box flexDirection="column" borderStyle="single" borderColor={TUI_THEME.surfaceBorder} paddingX={1}>
          <Text bold color={TUI_THEME.primary}>Commands</Text>
          {visibleCommands.map((command, index) => (
            <Box key={command.name}>
              <Text bold color={index === selectedIndex ? TUI_THEME.highlightedText : TUI_THEME.textDim}>
                {index === selectedIndex ? '❯ ' : '  '}
              </Text>
              <Text bold color={index === selectedIndex ? TUI_THEME.highlightedText : TUI_THEME.textPrimary}>
                {`/${command.name}`}
              </Text>
              <Text color={TUI_THEME.textDim}>{` ${command.description}`}</Text>
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
        borderColor={disabled ? TUI_THEME.textDim : TUI_THEME.surfaceBorder}
        columnGap={1}
      >
        <Text color={TUI_THEME.textPrimary}>{'❯'}</Text>
        <HighlightedInput value={value} />
      </Box>
    </Box>
  );
}
