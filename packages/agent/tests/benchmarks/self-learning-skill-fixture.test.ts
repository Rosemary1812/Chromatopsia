import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverSelfLearningSkillCases } from "../../../../benchmarks/scripts/self-learning-skill/fixture.js";
import type { SelfLearningSkillConfig } from "../../../../benchmarks/scripts/self-learning-skill/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "self-learning-skill-fixture-"));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(fixturesRoot: string): SelfLearningSkillConfig {
  return {
    suite: "self-learning-skill",
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
      learning_timeout_sec: 60,
      reuse_task_timeout_sec: 60,
      allow_writes_outside_workspace: false,
    },
    selection: {
      include_cases: [],
      exclude_cases: [],
    },
    paths: {
      fixtures_root: fixturesRoot,
      runs_root: "benchmarks/runs",
      reports_root: "benchmarks/reports",
    },
    scoring: {
      phase_weights: {
        learning_generation: 0.3,
        skill_quality: 0.3,
        reuse_effect: 0.4,
      },
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

async function writeCase(root: string, caseId: string): Promise<void> {
  const caseRoot = path.join(root, caseId);
  await fs.mkdir(path.join(caseRoot, "conversations"), { recursive: true });
  await fs.mkdir(path.join(caseRoot, "reuse-tasks", "task-a", "workspace", "tests"), { recursive: true });
  await fs.writeFile(path.join(caseRoot, "conversations", "learning-source.jsonl"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(caseRoot, "scenario.yaml"),
    `id: ${caseId}
title: Test case
description: Test case
learning_source:
  conversation: conversations/learning-source.jsonl
  task_type: test
  expected_action: create
  existing_skills: []
expected_skill:
  name_keywords: [test]
  trigger_keywords: [test]
  must_include: [verification]
  must_not_include: [secret]
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

describe("self-learning-skill fixture discovery", () => {
  it("discovers valid cases and ignores template files", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "scenario.template.yaml"), "id: template\n", "utf8");
    await writeCase(root, "case-b");
    await writeCase(root, "case-a");

    const cases = await discoverSelfLearningSkillCases(makeConfig(root));

    expect(cases.map((entry) => entry.caseId)).toEqual(["case-a", "case-b"]);
    expect(cases[0]?.reuseTasks).toHaveLength(1);
  });

  it("rejects cases with missing learning conversation", async () => {
    const root = await makeTempDir();
    await writeCase(root, "case-a");
    await fs.rm(path.join(root, "case-a", "conversations", "learning-source.jsonl"));

    await expect(discoverSelfLearningSkillCases(makeConfig(root))).rejects.toThrow(/learning source conversation/i);
  });

  it("rejects cases with missing reuse task workspace", async () => {
    const root = await makeTempDir();
    await writeCase(root, "case-a");
    await fs.rm(path.join(root, "case-a", "reuse-tasks", "task-a", "workspace"), { recursive: true, force: true });

    await expect(discoverSelfLearningSkillCases(makeConfig(root))).rejects.toThrow(/reuse task workspace/i);
  });
});
