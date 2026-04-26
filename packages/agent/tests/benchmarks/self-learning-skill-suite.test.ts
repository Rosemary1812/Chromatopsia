import { describe, expect, it } from "vitest";

import {
  classifySelfLearningSkillCaseFailure,
  computeSelfLearningSkillCaseScore,
} from "../../../../benchmarks/scripts/self-learning-skill/prepare-run.js";
import type { SelfLearningSkillCaseResult, SelfLearningSkillConfig } from "../../../../benchmarks/scripts/self-learning-skill/types.js";

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

function makeCase(): SelfLearningSkillCaseResult {
  return {
    case_id: "case-a",
    status: "completed",
    learning: {
      expected_action: "create",
      actual_action: "create",
      target_skill_id: null,
      draft_skill_path: "SKILL.md",
      errors: [],
      scores: { total: 0.8 },
    },
    skill_quality: {
      hard_checks_passed: true,
      hard_checks_path: "hard-checks.json",
      judgment_path: "judgment.json",
      scores: { total: 0.7 },
    },
    reuse_effect: {
      tasks: [],
      total: 0.6,
    },
  };
}

describe("self-learning-skill suite scoring", () => {
  it("computes weighted normal case score", () => {
    expect(computeSelfLearningSkillCaseScore(makeConfig(), makeCase())).toBeCloseTo(0.69);
  });

  it("classifies quality hard check failures", () => {
    const result = makeCase();
    result.skill_quality.hard_checks_passed = false;
    expect(classifySelfLearningSkillCaseFailure(result)).toBe("quality_hard_checks_failed");
  });

  it("scores skip cases from learning only", () => {
    const result = makeCase();
    result.learning.expected_action = "skip";
    result.learning.actual_action = "skip";
    result.learning.scores = { total: 1 };
    result.skill_quality.scores = { total: 0 };
    result.reuse_effect.total = 0;
    expect(computeSelfLearningSkillCaseScore(makeConfig(), result)).toBe(1);
  });

  it("classifies learning action mismatches", () => {
    const result = makeCase();
    result.learning.actual_action = "skip";
    expect(classifySelfLearningSkillCaseFailure(result)).toBe("learning_action_mismatch");
  });

  it("classifies reuse trial errors", () => {
    const result = makeCase();
    result.reuse_effect.tasks = [{
      task_id: "reuse-a",
      modes: { with_skill_discovery: { status: "error" } },
      scores: { task_success_delta: 0.5, total: 0.5 },
    }];
    expect(classifySelfLearningSkillCaseFailure(result)).toBe("reuse_trial_error");
  });

  it("classifies reuse regressions", () => {
    const result = makeCase();
    result.reuse_effect.tasks = [{
      task_id: "reuse-a",
      modes: {},
      scores: { task_success_delta: 0.25, total: 0.25 },
    }];
    expect(classifySelfLearningSkillCaseFailure(result)).toBe("reuse_regression");
  });

});
