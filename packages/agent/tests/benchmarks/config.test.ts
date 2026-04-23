import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadFoundationConfig } from "../../../../benchmarks/scripts/utils/config.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "benchmark-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("benchmark config loader", () => {
  it("loads a valid foundation config file", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "foundation.yaml");

    await fs.writeFile(
      configPath,
      `suite: foundation
run:
  name: test-run
  description: test config
  generate_run_id: true
  random_seed: 7
model:
  provider: openai
  name: gpt-5.4-mini
  temperature: 0
  max_tokens: 4096
runtime:
  network: disabled
  workspace_mode: temp-dir
  max_concurrency: 2
  per_task_timeout_sec: 60
  allow_writes_outside_workspace: false
selection:
  categories: [bug-fix]
  include_tasks: []
  exclude_tasks: []
paths:
  fixtures_root: benchmarks/fixtures/foundation
  runs_root: benchmarks/runs
  reports_root: benchmarks/reports
scoring:
  enabled_metrics: [B1, B2, B3, B4, B5]
  weights:
    B1: 0.4
    B2: 0.3
    B3: 0.2
    B4: 0.1
    B5: 0
    B6: 0
  cost_weights:
    tool_calls: 0.25
    duration_ms: 0.25
    token_usage: 0.25
    redundant_reads: 0.25
judge:
  context:
    provider: openai
    model: gpt-5.4-mini
    prompt_file: benchmarks/configs/judge/context-use.prompt.md
  compression:
    provider: openai
    model: gpt-5.4-mini
    prompt_file: benchmarks/configs/judge/compression.prompt.md
trace:
  format: jsonl
  record_tool_calls: true
  record_file_reads: true
  record_file_writes: true
  record_acceptance_checks: true
  record_token_usage: true
  record_approval_events: true
`,
      "utf8",
    );

    const config = await loadFoundationConfig(configPath);

    expect(config.suite).toBe("foundation");
    expect(config.runtime.max_concurrency).toBe(2);
    expect(config.scoring.weights.B1).toBe(0.4);
    expect(config.scoring.enabled_metrics).toEqual(["B1", "B2", "B3", "B4", "B5"]);
  });

  it("rejects configs that violate the schema", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "foundation.yaml");

    await fs.writeFile(
      configPath,
      `suite: foundation
run:
  name: invalid
  description: invalid config
  generate_run_id: true
  random_seed: 7
model:
  provider: openai
  name: gpt-5.4-mini
  temperature: 0
  max_tokens: 4096
runtime:
  network: disabled
  workspace_mode: temp-dir
  max_concurrency: 0
  per_task_timeout_sec: 60
  allow_writes_outside_workspace: false
selection:
  categories: [bug-fix]
  include_tasks: []
  exclude_tasks: []
paths:
  fixtures_root: benchmarks/fixtures/foundation
  runs_root: benchmarks/runs
  reports_root: benchmarks/reports
scoring:
  enabled_metrics: [B1]
  weights:
    B1: 1
    B2: 0
    B3: 0
    B4: 0
    B5: 0
    B6: 0
  cost_weights:
    tool_calls: 1
    duration_ms: 0
    token_usage: 0
    redundant_reads: 0
judge:
  context:
    provider: openai
    model: gpt-5.4-mini
    prompt_file: benchmarks/configs/judge/context-use.prompt.md
  compression:
    provider: openai
    model: gpt-5.4-mini
    prompt_file: benchmarks/configs/judge/compression.prompt.md
trace:
  format: jsonl
  record_tool_calls: true
  record_file_reads: true
  record_file_writes: true
  record_acceptance_checks: true
  record_token_usage: true
  record_approval_events: true
`,
      "utf8",
    );

    await expect(loadFoundationConfig(configPath)).rejects.toThrow();
  });
});
