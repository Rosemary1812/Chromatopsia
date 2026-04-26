import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkSkillQualityHardChecks } from "../../../../benchmarks/scripts/self-learning-skill/quality-checks.js";
import { scoreSkillQuality } from "../../../../benchmarks/scripts/self-learning-skill/quality-score.js";
import type { ExpectedSkillConfig, SelfLearningSkillConfig } from "../../../../benchmarks/scripts/self-learning-skill/types.js";

const tempDirs: string[] = [];

const validSkillMarkdown = `---
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
Do not expose credentials or overfit one-off machine details.
`;

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "self-learning-skill-quality-"));
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

const expectedSkill: ExpectedSkillConfig = {
  name_keywords: ["Project", "Test"],
  trigger_keywords: ["project test command"],
  must_include: ["package-filtered vitest command"],
  must_not_include: ["secret value", "temporary local path"],
  expected_action: { type: "create", target_skill_id: null },
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("self-learning-skill quality checks", () => {
  it("accepts a generated skill that can be loaded by store, registry, and Skill tool", async () => {
    const dir = await makeTempDir();
    const skillPath = path.join(dir, "learning", "draft", "SKILL.md");
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, validSkillMarkdown, "utf8");

    const hardChecks = await checkSkillQualityHardChecks({
      skillPath,
      caseRoot: dir,
      requiredSections: ["When To Use", "Procedure", "Verification"],
    });
    const scores = await scoreSkillQuality(makeConfig(dir, path.join(dir, "runs")), expectedSkill, hardChecks);

    expect(hardChecks.passed).toBe(true);
    expect(hardChecks.checks.find((check) => check.id === "skill_tool_load_by_name")?.passed).toBe(true);
    expect(scores.total).toBe(1);
  });

  it("reports parse failures for invalid SKILL.md", async () => {
    const dir = await makeTempDir();
    const skillPath = path.join(dir, "SKILL.md");
    await fs.writeFile(skillPath, "# Missing frontmatter\n", "utf8");

    const hardChecks = await checkSkillQualityHardChecks({ skillPath, caseRoot: dir });

    expect(hardChecks.passed).toBe(false);
    expect(hardChecks.parsed).toBe(false);
    expect(hardChecks.errors[0]).toContain("frontmatter");
  });
});
