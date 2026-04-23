import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverFoundationFixtures } from "../../../../benchmarks/scripts/utils/foundation-fixture.js";
import type { FoundationConfig } from "../../../../benchmarks/scripts/utils/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "benchmark-fixture-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFixture(options: {
  root: string;
  category: string;
  taskId: string;
  descriptionCategory?: string;
  mustReadFiles?: string[];
}): Promise<void> {
  const fixtureRoot = path.join(options.root, options.category, options.taskId);
  await fs.mkdir(path.join(fixtureRoot, "workspace", "src"), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, "expected"), { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, "workspace", "src", "main.py"), "print('ok')\n", "utf8");
  await fs.writeFile(path.join(fixtureRoot, "expected", "solution.md"), "done\n", "utf8");
  await fs.writeFile(
    path.join(fixtureRoot, "description.yaml"),
    `id: ${options.taskId}
category: ${options.descriptionCategory ?? options.category}
language: python
difficulty: easy
title: ${options.taskId}
description: Fix the task
acceptance:
  - type: test
    command: python -m pytest -q
timeout: 30
must_read_files:
${(options.mustReadFiles ?? ["src/main.py"]).map((file) => `  - ${file}`).join("\n")}
`,
    "utf8",
  );
}

function makeConfig(fixturesRoot: string): FoundationConfig {
  return {
    suite: "foundation",
    run: {
      name: "test",
      description: "test",
      generate_run_id: true,
      random_seed: 1,
    },
    model: {
      provider: "openai",
      name: "gpt-5.4-mini",
      temperature: 0,
      max_tokens: 4096,
    },
    runtime: {
      network: "disabled",
      workspace_mode: "temp-dir",
      max_concurrency: 1,
      per_task_timeout_sec: 60,
      allow_writes_outside_workspace: false,
    },
    selection: {
      categories: ["bug-fix"],
      include_tasks: [],
      exclude_tasks: [],
    },
    paths: {
      fixtures_root: fixturesRoot,
      runs_root: "benchmarks/runs",
      reports_root: "benchmarks/reports",
    },
    scoring: {
      enabled_metrics: ["B1", "B2", "B3", "B4", "B5", "B6"],
      weights: {
        B1: 0.25,
        B2: 0.2,
        B3: 0.15,
        B4: 0.15,
        B5: 0.15,
        B6: 0.1,
      },
      cost_weights: {
        tool_calls: 0.35,
        duration_ms: 0.3,
        token_usage: 0.2,
        redundant_reads: 0.15,
      },
    },
    judge: {
      context: {
        provider: "openai",
        model: "gpt-5.4-mini",
        prompt_file: "benchmarks/configs/judge/context-use.prompt.md",
      },
      compression: {
        provider: "openai",
        model: "gpt-5.4-mini",
        prompt_file: "benchmarks/configs/judge/compression.prompt.md",
      },
    },
    trace: {
      format: "jsonl",
      record_tool_calls: true,
      record_file_reads: true,
      record_file_writes: true,
      record_acceptance_checks: true,
      record_token_usage: true,
      record_approval_events: true,
    },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("foundation fixture discovery", () => {
  it("discovers and sorts valid fixtures", async () => {
    const root = await makeTempDir();
    await writeFixture({ root, category: "bug-fix", taskId: "bug-fix-002" });
    await writeFixture({ root, category: "bug-fix", taskId: "bug-fix-001" });

    const fixtures = await discoverFoundationFixtures(makeConfig(root));

    expect(fixtures.map((fixture) => fixture.taskId)).toEqual(["bug-fix-001", "bug-fix-002"]);
  });

  it("rejects fixtures whose description category does not match the directory", async () => {
    const root = await makeTempDir();
    await writeFixture({
      root,
      category: "bug-fix",
      taskId: "bug-fix-001",
      descriptionCategory: "feature",
    });

    await expect(discoverFoundationFixtures(makeConfig(root))).rejects.toThrow(/category mismatch/i);
  });

  it("rejects fixtures when must_read_files points to a missing file", async () => {
    const root = await makeTempDir();
    await writeFixture({
      root,
      category: "bug-fix",
      taskId: "bug-fix-001",
      mustReadFiles: ["src/missing.py"],
    });

    await expect(discoverFoundationFixtures(makeConfig(root))).rejects.toThrow(/must_read_files/i);
  });
});
