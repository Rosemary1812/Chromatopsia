import { Box, Text } from "ink";
import { BRAND_LOGO, TUI_THEME, getModeColor, getModeLabel, truncateMiddle } from "../types.js";

type HeaderProps = {
  model: string;
  cwd: string;
  mode: "idle" | "working" | "approval";
  version: string;
};

export function Header({ model, cwd, mode, version }: HeaderProps) {
  return (
    <Box columnGap={2}>
      <Box flexDirection="column">
        {BRAND_LOGO.map((line) => (
          <Text key={line} color={TUI_THEME.primary}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Box columnGap={1}>
          <Text bold color={TUI_THEME.primary}>
            {"Chromatopsia"}
          </Text>
          <Text color={TUI_THEME.textDim}>{`v${version}`}</Text>
          <Text color={getModeColor(mode)}>{getModeLabel(mode)}</Text>
        </Box>
        <Text color={TUI_THEME.textDim}>{model}</Text>
        <Text color={TUI_THEME.textDim}>{truncateMiddle(cwd)}</Text>
      </Box>
    </Box>
  );
}
