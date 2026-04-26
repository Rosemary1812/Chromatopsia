import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverSelfLearningSkillCases } from "../../../../benchmarks/scripts/self-learning-skill/fixture.js";
import { runLearningGeneration } from "../../../../benchmarks/scripts/self-learning-skill/learning-runner.js";
import { scoreLearningGeneration } from "../../../../benchmarks/scripts/self-learning-skill/learning-score.js";
import { SelfLearningSkillTraceWriter } from "../../../../benchmarks/scripts/self-learning-skill/trace.js";
import type { SelfLearningSkillConfig } from "../../../../benchmarks/scripts/self-learning-skill/types.js";
import type { LLMProvider } from "../../src/foundation/types.js";

const tempDirs: string[] = [];

const skillMarkdown = `---
id: project-test-command
name: Project Test Command
description: Use when selecting the correct project test command.
user-invocable: true
context: inline
triggers:
  - project test command
task_type: test
scope: learning_draft
enabled: false
priority: 10
version: 1
updated_at: 2026-04-25T00:00:00.000Z
---

# Project Test Command

## When To Use
Use this when a task needs the project-specific test command.

## Procedure
Run the package-filtered vitest command before claiming completion.

## Verification
Confirm the package-filtered vitest command passed.

## Pitfalls
Do not expose credentials or overfit one-off machine details.`;

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "self-learning-skill-learning-"));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(fixturesRoot: string, runsRoot: string): SelfLearningSkillConfig {
  return {
    suite: "self-learning-skill",
    run: { name: "test", description: "test", generate_run_id: true, random_seed: 1 },
    model: { provider: "openai", name: "gpt-5.4-mini", temperature: 0, max_tokens: 4096 },
    runtime: {
      network: "disabled",
      workspace_mode: "temp-dir",
      max_concurrency: 1,
      learning_timeout_sec: 60,
      reuse_task_timeout_sec: 60,
      allow_writes_outside_workspace: false,
    },
    selection: { include_cases: [], exclude_cases: [] },
    paths: { fixtures_root: fixturesRoot, runs_root: runsRoot, reports_root: "benchmarks/reports" },
    scoring: {
      phase_weights: { learning_generation: 0.3, skill_quality: 0.3, reuse_effect: 0.4 },
      learning_generation: {
        trigger_correctness: 0.2,
        action_correctness: 0.2,
        target_correctness: 0.15,
        key_experience_recall: 0.3,
        noise_suppression: 0.15,
      },
      skill_quality: {
        format_schema: 0.15,
        correctness: 0.25,
        clarity: 0.15,
        reusability: 0.2,
        specificity: 0.15,
        safety_verification: 0.1,
      },
      reuse_effect: {
        task_success_delta: 0.3,
        skill_load_correctness: 0.15,
        efficiency_delta: 0.2,
        guidance_adherence: 0.2,
        harm_avoidance: 0.15,
      },
    },
    judge: {
      learning: { provider: "openai", model: "gpt-5.4-mini", prompt_file: "learning.md" },
      quality: { provider: "openai", model: "gpt-5.4-mini", prompt_file: "quality.md" },
      reuse: { provider: "openai", model: "gpt-5.4-mini", prompt_file: "reuse.md" },
    },
    trace: {
      format: "jsonl",
      record_tool_calls: true,
      record_skill_loads: true,
      record_file_reads: true,
      record_file_writes: true,
      record_shell_commands: true,
      record_acceptance_checks: true,
      record_token_usage: true,
      record_approval_events: true,
      record_learning_events: true,
    },
  };
}

function makeProvider(content: string): LLMProvider {
  return {
    name: "mock",
    chat: vi.fn(async () => ({ content, finish_reason: "stop" })),
    chat_stream: vi.fn(),
    get_model: () => "mock-model",
  };
}

async function writeCase(root: string): Promise<void> {
  const caseRoot = path.join(root, "learn-test-command-001");
  await fs.mkdir(path.join(caseRoot, "conversations"), { recursive: true });
  await fs.mkdir(path.join(caseRoot, "reuse-tasks", "task-a", "workspace", "tests"), { recursive: true });
  const sourceLines = [
    {
      task_type: "test",
      user_input: "run tests",
      tool_calls: [{ id: "tc-1", name: "RunShell", arguments: { command: "vitest run" } }],
      tool_results: [{ tool_call_id: "tc-1", output: "failed", success: false }],
      final_outcome: "failed",
    },
    {
      task_type: "test",
      user_input: "use the package-filtered command",
      tool_calls: [{ id: "tc-2", name: "RunShell", arguments: { command: "pnpm --filter @chromatopsia/agent exec vitest run" } }],
      tool_results: [{ tool_call_id: "tc-2", output: "passed", success: true }],
      final_outcome: "success",
    },
  ].map((line) => JSON.stringify(line)).join("\n");
  await fs.writeFile(path.join(caseRoot, "conversations", "learning-source.jsonl"), `${sourceLines}\n`, "utf8");
  await fs.writeFile(
    path.join(caseRoot, "scenario.yaml"),
    `id: learn-test-command-001
title: Learn test command
description: Learn the project-specific test command.
learning_source:
  conversation: conversations/learning-source.jsonl
  task_type: test
  expected_action: create
  existing_skills: []
expected_skill:
  name_keywords: [test]
  trigger_keywords: [test]
  must_include:
    - package-filtered vitest command
  must_not_include:
    - secret value
    - temporary local path
  expected_action:
    type: create
    target_skill_id: null
reuse:
  tasks:
    - id: reuse-a
      workspace: reuse-tasks/task-a/workspace
      acceptance:
        - type: shell
          command: "python tests/check_result.py"
          expect_exit_code: 0
`,
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("self-learning-skill learning phase", () => {
  it("runs LearningWorker from source turns and scores the generated draft", async () => {
    const root = await makeTempDir();
    await writeCase(root);
    const config = makeConfig(root, path.join(root, "runs"));
    const [caseInfo] = await discoverSelfLearningSkillCases(config);
    const caseRoot = path.join(root, "runs", "run-1", "self-learning-skill", "cases", caseInfo.caseId);
    const trace = new SelfLearningSkillTraceWriter(path.join(caseRoot, "traces", "learning.jsonl"));
    const provider = makeProvider(JSON.stringify({
      decision: "create",
      confidence: 0.9,
      reasoning: "Reusable test-command guidance.",
      target_skill_id: null,
      evidence: ["failed generic command", "successful package-filtered vitest command"],
      risk_notes: [],
      skill_markdown: skillMarkdown,
    }));

    const learning = await runLearningGeneration({
      runId: "run-1",
      config,
      caseInfo,
      caseRoot,
      trace,
      provider,
    });
    learning.scores = await scoreLearningGeneration(config, caseInfo.scenario.expected_skill, learning);

    expect(learning.errors).toEqual([]);
    expect(learning.actual_action).toBe("create");
    expect(learning.draft_skill_path).toBeTruthy();
    expect(learning.scores.total).toBe(1);
    await expect(fs.readFile(learning.draft_skill_path ?? "", "utf8")).resolves.toContain("package-filtered vitest command");
  });
});


