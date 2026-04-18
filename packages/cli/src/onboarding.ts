import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import * as readline from "node:readline";
import readlinePromises from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getUserConfigPath, type ProviderType } from "@chromatopsia/agent";

type SupportedProvider = Extract<
  ProviderType,
  "openai" | "anthropic" | "openai-compatible"
>;
type ThemeMode = "dark" | "light";

interface ProviderOption {
  label: string;
  value: SupportedProvider;
  models: string[];
  defaultModel: string;
  defaultBaseUrl?: string;
}

interface SelectOption<T extends string> {
  label: string;
  value: T;
  hint?: string;
}

export interface OnboardingResult {
  configPath: string;
}

interface OnboardingOptions {
  configPath?: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    label: "OpenAI",
    value: "openai",
    models: ["gpt-4o", "gpt-4.1", "gpt-4.1-mini"],
    defaultModel: "gpt-4o",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    label: "Anthropic",
    value: "anthropic",
    models: ["claude-opus-4-6", "claude-sonnet-4-5"],
    defaultModel: "claude-opus-4-6",
  },
  {
    label: "OpenAI-compatible",
    value: "openai-compatible",
    models: ["gpt-4o", "gpt-4.1", "deepseek-chat"],
    defaultModel: "gpt-4o",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
];

const CUSTOM_MODEL_VALUE = "__custom_model__";
const DEFAULT_BASE_URL_VALUE = "__default_base_url__";
const CUSTOM_BASE_URL_VALUE = "__custom_base_url__";

export async function runOnboarding(
  options: OnboardingOptions = {},
): Promise<OnboardingResult> {
  readline.emitKeypressEvents(input);
  output.write("\nChromatopsia first-run setup\n");
  output.write("Use arrow keys to choose options. Press Enter to confirm.\n");
  output.write("Text fields still accept direct typing.\n\n");

  const provider = await promptSelect(
    "Choose a provider",
    PROVIDERS.map((item) => ({
      label: item.label,
      value: item.value,
      hint:
        item.value === "openai-compatible"
          ? "Use this if you rely on a custom OpenAI-style endpoint."
          : undefined,
    })),
  );
  const providerMeta = PROVIDERS.find((item) => item.value === provider)!;

  const selectedModel = await promptSelect(
    `Choose a model preset for ${providerMeta.label}`,
    [
      ...providerMeta.models.map((model) => ({
        label: model,
        value: model,
      })),
      {
        label: "Custom model",
        value: CUSTOM_MODEL_VALUE,
        hint: "Type any model name yourself.",
      },
    ],
    providerMeta.models.indexOf(providerMeta.defaultModel),
  );
  const model =
    selectedModel === CUSTOM_MODEL_VALUE
      ? await promptText("Enter the model name", { required: true })
      : selectedModel;

  const apiKey = await promptSecret("Enter your API key");

  const baseUrl = await resolveBaseUrlStep(providerMeta);

  const theme = (await promptSelect("Choose a theme", [
    { label: "Dark", value: "dark" },
    { label: "Light", value: "light" },
  ])) as ThemeMode;

  const targetPath = path.resolve(options.configPath ?? getUserConfigPath());
  output.write("\nConfiguration summary\n");
  output.write(`- Provider: ${provider}\n`);
  output.write(`- Model: ${model}\n`);
  output.write(`- API key: ${maskSecret(apiKey)}\n`);
  output.write(`- Base URL: ${baseUrl ?? "(provider default)"}\n`);
  output.write(`- Theme: ${theme}\n`);
  output.write(`- Config path: ${targetPath}\n\n`);

  const confirmed = await promptConfirm(
    "Save this config and launch Chromatopsia?",
    true,
  );
  if (!confirmed) {
    throw new Error("Onboarding cancelled.");
  }

  await writeConfigFile(
    targetPath,
    buildConfigYaml({
      provider,
      model,
      apiKey,
      baseUrl,
      theme,
    }),
  );

  output.write(`\nSaved config to ${targetPath}\n\n`);
  return { configPath: targetPath };
}

async function resolveBaseUrlStep(
  provider: ProviderOption,
): Promise<string | undefined> {
  const baseUrlMode = await promptSelect(
    "Base URL",
    [
      {
        label: "Use provider default endpoint",
        value: DEFAULT_BASE_URL_VALUE,
        hint: provider.defaultBaseUrl
          ? `Default: ${provider.defaultBaseUrl}`
          : "No explicit base URL will be written.",
      },
      {
        label: "Enter a custom base URL",
        value: CUSTOM_BASE_URL_VALUE,
        hint: "Use this for proxies, gateways, or provider-compatible endpoints.",
      },
    ],
    provider.value === "openai-compatible" ? 1 : 0,
  );

  if (baseUrlMode === DEFAULT_BASE_URL_VALUE) {
    return undefined;
  }

  output.write("\nThe custom base URL will be written into config.yaml.\n");
  return promptText("Enter the base URL", {
    required: true,
    defaultValue: provider.defaultBaseUrl,
  });
}

async function promptSelect<T extends string>(
  label: string,
  options: Array<SelectOption<T>>,
  initialIndex = 0,
): Promise<T> {
  if (!input.isTTY) {
    throw new Error("Interactive selection requires a TTY.");
  }

  let selectedIndex = Math.max(0, Math.min(initialIndex, options.length - 1));
  let renderedLines = 0;

  const render = () => {
    const lines = [
      "",
      label,
      "Use ↑/↓ to choose, Enter to confirm.",
      ...options.map((option, index) => {
        const prefix = index === selectedIndex ? "›" : " ";
        const hint = option.hint ? `  ${option.hint}` : "";
        return `${prefix} ${option.label}${hint}`;
      }),
      "",
    ];

    if (renderedLines > 0) {
      readline.moveCursor(output, 0, -renderedLines);
      readline.clearScreenDown(output);
    }

    output.write(lines.join("\n"));
    renderedLines = lines.length;
  };

  return new Promise<T>((resolve) => {
    const previousRawMode = input.isRaw;
    input.setRawMode?.(true);
    input.resume();
    render();

    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode?.(previousRawMode ?? false);
      output.write("\n");
    };

    const onKeypress = (_value: string, key: readline.Key) => {
      if (key.name === "up") {
        selectedIndex =
          selectedIndex === 0 ? options.length - 1 : selectedIndex - 1;
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex =
          selectedIndex === options.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }

      if (key.name === "return") {
        const selected = options[selectedIndex];
        cleanup();
        resolve(selected.value);
      }
    };

    input.on("keypress", onKeypress);
  });
}

async function promptText(
  label: string,
  options: { required?: boolean; defaultValue?: string } = {},
): Promise<string> {
  while (true) {
    const suffix = options.defaultValue ? ` [${options.defaultValue}]` : "";
    const answer = (
      await withQuestionInterface((rl) =>
        rl.question(`\n${label}${suffix}\n> `),
      )
    ).trim();
    if (answer) {
      return answer;
    }
    if (options.defaultValue) {
      return options.defaultValue;
    }
    if (!options.required) {
      return "";
    }
    output.write("This field is required.\n");
  }
}

async function promptSecret(label: string): Promise<string> {
  return withQuestionInterface(async (rl) => {
    const writable = rl as readlinePromises.Interface & {
      _writeToOutput?: (value: string) => void;
    };
    const previousWrite = writable._writeToOutput;
    writable._writeToOutput = (value: string) => {
      if (value.includes("\n")) {
        output.write(value);
        return;
      }
      output.write("*");
    };

    try {
      while (true) {
        const answer = (await rl.question(`\n${label}\n> `)).trim();
        if (answer) {
          return answer;
        }
        output.write("This field is required.\n");
      }
    } finally {
      writable._writeToOutput = previousWrite;
    }
  });
}

async function withQuestionInterface<T>(
  runner: (rl: readlinePromises.Interface) => Promise<T>,
): Promise<T> {
  const rl = readlinePromises.createInterface({ input, output });
  try {
    return await runner(rl);
  } finally {
    rl.close();
  }
}

async function promptConfirm(
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const result = await promptSelect(
    label,
    [
      { label: "Confirm and continue", value: "yes" },
      { label: "Cancel onboarding", value: "no" },
    ],
    defaultValue ? 0 : 1,
  );
  return result === "yes";
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(Math.max(4, value.length));
  }
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

function buildConfigYaml(input: {
  provider: SupportedProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  theme: ThemeMode;
}): string {
  const providerBlock = [
    `${input.provider}:`,
    `  api_key: "${escapeYaml(input.apiKey)}"`,
    `  model: "${escapeYaml(input.model)}"`,
  ];

  if (input.baseUrl) {
    providerBlock.push(`  base_url: "${escapeYaml(input.baseUrl)}"`);
  }

  return [
    "# Generated by Chromatopsia onboarding",
    `provider: ${input.provider}`,
    "",
    ...providerBlock,
    "",
    "tui:",
    `  theme: ${input.theme}`,
    "",
  ].join("\n");
}

async function writeConfigFile(
  configPath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, configPath);
}

function escapeYaml(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
