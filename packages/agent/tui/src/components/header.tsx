import { Box, Text } from "ink";
import { BRAND_LOGO, getModeColor, getModeLabel, truncateMiddle, type TuiThemePalette } from "../types.js";

type HeaderProps = {
  model: string;
  cwd: string;
  mode: "idle" | "working" | "approval";
  version: string;
  theme: TuiThemePalette;
};

export function Header({ model, cwd, mode, version, theme }: HeaderProps) {
  return (
    <Box columnGap={2}>
      <Box flexDirection="column">
        {BRAND_LOGO.map((line) => (
          <Text key={line} color={theme.primary}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Box columnGap={1}>
          <Text bold color={theme.primary}>
            {"Chromatopsia"}
          </Text>
          <Text color={theme.textDim}>{`v${version}`}</Text>
          <Text color={getModeColor(mode, theme)}>{getModeLabel(mode)}</Text>
        </Box>
        <Text color={theme.textDim}>{model}</Text>
        <Text color={theme.textDim}>{truncateMiddle(cwd)}</Text>
      </Box>
    </Box>
  );
}
