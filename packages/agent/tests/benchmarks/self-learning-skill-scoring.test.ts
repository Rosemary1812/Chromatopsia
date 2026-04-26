import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scoreLearningGeneration } from "../../../../benchmarks/scripts/self-learning-skill/learning-score.js";
import { rescoreSelfLearningSkillRun } from "../../../../benchmarks/scripts/self-learning-skill/score-self-learning-skill.js";
import type {
  ExpectedSkillConfig,
  LearningPhaseResult,
  SelfLearningSkillCaseInfo,
  SelfLearningSkillConfig,
  SelfLearningSkillRunResult,
} from "../../../../benchmarks/scripts/self-learning-skill/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "self-learning-skill-scoring-"));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(): SelfLearningSkillConfig {
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
    paths: { fixtures_root: "fixtures", runs_root: "runs", reports_root: "reports" },
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

function expected(type: ExpectedSkillConfig["expected_action"]["type"], target: string | null = null): ExpectedSkillConfig {
  return {
    name_keywords: ["test"],
    trigger_keywords: ["test"],
    must_include: ["package-filtered vitest command", "verification step"],
    must_not_include: ["secret value", "temporary local path"],
    expected_action: { type, target_skill_id: target },
  };
}

async function writeDraft(content: string): Promise<string> {
  const dir = await makeTempDir();
  const file = path.join(dir, "SKILL.md");
  await fs.writeFile(file, content, "utf8");
  return file;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("self-learning-skill learning scoring", () => {
  it("scores create decisions with lexical recall and noise suppression", async () => {
    const draftPath = await writeDraft("Use the package-filtered vitest command and include a verification step.");
    const learning: LearningPhaseResult = {
      expected_action: "create",
      actual_action: "create",
      target_skill_id: null,
      draft_skill_path: draftPath,
      errors: [],
    };

    const scores = await scoreLearningGeneration(makeConfig(), expected("create"), learning);

    expect(scores.trigger_correctness).toBe(1);
    expect(scores.action_correctness).toBe(1);
    expect(scores.key_experience_recall).toBe(1);
    expect(scores.noise_suppression).toBe(1);
    expect(scores.total).toBe(1);
  });

  it("scores patch target correctness", async () => {
    const draftPath = await writeDraft("Use the package-filtered vitest command and include a verification step.");
    const learning: LearningPhaseResult = {
      expected_action: "patch",
      actual_action: "patch",
      target_skill_id: "project-test-command",
      draft_skill_path: draftPath,
      errors: [],
    };

    const scores = await scoreLearningGeneration(makeConfig(), expected("patch", "project-test-command"), learning);

    expect(scores.target_correctness).toBe(1);
    expect(scores.total).toBe(1);
  });

  it("scores skip decisions without requiring a draft", async () => {
    const learning: LearningPhaseResult = {
      expected_action: "skip",
      actual_action: "skip",
      target_skill_id: null,
      draft_skill_path: null,
      errors: [],
    };

    const scores = await scoreLearningGeneration(makeConfig(), expected("skip"), learning);

    expect(scores.trigger_correctness).toBe(1);
    expect(scores.action_correctness).toBe(1);
    expect(scores.total).toBe(1);
  });
});


describe("self-learning-skill run rescoring", () => {
  it("recomputes learning scores and case summaries from an existing run result", async () => {
    const draftPath = await writeDraft("Use the package-filtered vitest command and include a verification step.");
    const config = makeConfig();
    const caseInfo = {
      caseId: "case-a",
      fixtureDir: "fixture",
      scenarioPath: "fixture/scenario.yaml",
      scenario: {
        id: "case-a",
        title: "Case A",
        description: "Case A",
        learning_source: {
          conversation: "conversation.md",
          task_type: "workflow",
          expected_action: "create",
          existing_skills: [],
        },
        expected_skill: expected("create"),
        reuse: { tasks: [] },
      },
      learningConversationPath: "fixture/conversation.md",
      existingSkillPaths: [],
      reuseTasks: [],
    } satisfies SelfLearningSkillCaseInfo;
    const run: SelfLearningSkillRunResult = {
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
          draft_skill_path: draftPath,
          errors: [],
          scores: { total: 0 },
        },
        skill_quality: {
          hard_checks_passed: false,
          hard_checks_path: null,
          judgment_path: null,
          scores: { total: 0 },
        },
        reuse_effect: { tasks: [] },
        summary: { case_score: 0 },
      }],
    };

    const rescored = await rescoreSelfLearningSkillRun({ config, run, cases: [caseInfo] });

    expect(rescored.cases[0].learning.scores?.total).toBe(1);
    expect(rescored.cases[0].summary?.case_score).toBe(config.scoring.phase_weights.learning_generation);
    expect(rescored.cases[0].summary?.failure_category).toBe("quality_hard_checks_failed");
  });
});
