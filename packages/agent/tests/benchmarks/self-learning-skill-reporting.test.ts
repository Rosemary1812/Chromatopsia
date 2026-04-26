import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeSelfLearningSkillReport } from "../../../../benchmarks/scripts/self-learning-skill/reporting.js";
import type { SelfLearningSkillConfig, SelfLearningSkillRunResult } from "../../../../benchmarks/scripts/self-learning-skill/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "self-learning-skill-report-"));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(reportsRoot: string): SelfLearningSkillConfig {
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
    paths: { fixtures_root: "fixtures", runs_root: "runs", reports_root: reportsRoot },
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

function makeRun(): SelfLearningSkillRunResult {
  return {
    schema_version: "self-learning-skill/result/v0.1",
    meta: {
      run_id: "run-1",
      timestamp: "2026-04-25T00:00:00.000Z",
      duration_seconds: 1,
      model: "openai:gpt-5.4-mini",
      total_cases: 1,
      status: "completed",
    },
    cases: [{
      case_id: "case-a",
      status: "completed",
      learning: {
        expected_action: "create",
        actual_action: "create",
        target_skill_id: null,
        draft_skill_path: "SKILL.md",
        errors: [],
        scores: { total: 1 },
      },
      skill_quality: {
        hard_checks_passed: true,
        hard_checks_path: "hard-checks.json",
        judgment_path: "judgment.json",
        scores: { total: 1 },
      },
      reuse_effect: {
        tasks: [],
        total: 1,
      },
      summary: { case_score: 1 },
    }],
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("self-learning-skill reporting", () => {
  it("writes archived JSON and HTML report", async () => {
    const dir = await makeTempDir();
    const artifacts = await writeSelfLearningSkillReport("run-1", makeConfig(dir), makeRun(), "2026-04-25T00-00-00Z");

    await expect(fs.readFile(artifacts.jsonPath, "utf8")).resolves.toContain('"case_id": "case-a"');
    await expect(fs.readFile(artifacts.htmlPath, "utf8")).resolves.toContain("Self Learning Skill Evaluation");
  });
});
