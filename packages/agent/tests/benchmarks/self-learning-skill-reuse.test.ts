import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scoreReuseEffect } from "../../../../benchmarks/scripts/self-learning-skill/reuse-score.js";
import type {
  ReuseTaskInfo,
  ReuseTrialResult,
  SelfLearningSkillCaseInfo,
  SelfLearningSkillConfig,
} from "../../../../benchmarks/scripts/self-learning-skill/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "self-learning-skill-reuse-"));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(root: string): SelfLearningSkillConfig {
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
    paths: { fixtures_root: root, runs_root: path.join(root, "runs"), reports_root: path.join(root, "reports") },
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

function makeTrial(root: string, status: ReuseTrialResult["status"], overrides: Partial<ReuseTrialResult> = {}): ReuseTrialResult {
  return {
    task_id: "reuse-a",
    mode: "without_skill",
    workspace_path: root,
    trace_path: path.join(root, "trace.jsonl"),
    trial_root: root,
    agent_config_path: path.join(root, "agent-config.json"),
    agent_session_id: "session-1",
    status,
    skill_installed: false,
    skill_directory_exposed: false,
    forced_skill_guidance: false,
    expected_skill_load: true,
    skill_loaded: false,
    skill_loads: [],
    acceptance_passed: status === "passed" ? 1 : 0,
    acceptance_total: 1,
    duration_ms: 1000,
    token_usage: 1000,
    tool_calls: 10,
    failed_commands: 2,
    approval_requests: 0,
    compressed_turns: 0,
    errors: [],
    acceptance_checks: [{
      kind: "acceptance",
      name: "acceptance-1",
      type: "shell",
      command: "node check.js",
      passed: status === "passed",
      exit_code: status === "passed" ? 0 : 1,
      duration_ms: 10,
      stdout: "",
      stderr: "",
      expected_exit_code: 0,
    }],
    ...overrides,
  };
}

async function makeCase(root: string): Promise<SelfLearningSkillCaseInfo> {
  const fixtureDir = path.join(root, "case");
  const workspaceDir = path.join(fixtureDir, "reuse-workspace");
  await fs.mkdir(workspaceDir, { recursive: true });
  const task: ReuseTaskInfo = {
    id: "reuse-a",
    workspaceDir,
    config: {
      id: "reuse-a",
      workspace: "reuse-workspace",
      acceptance: [{ type: "shell", command: "node check.js", expect_exit_code: 0 }],
      expected_skill_load: true,
      key_behaviors: ["package-filtered vitest command"],
    },
  };
  return {
    caseId: "case-a",
    fixtureDir,
    scenarioPath: path.join(fixtureDir, "scenario.yaml"),
    learningConversationPath: path.join(fixtureDir, "learning-source.jsonl"),
    existingSkillPaths: [],
    reuseTasks: [task],
    scenario: {
      id: "case-a",
      title: "Case A",
      description: "Use learned test command.",
      learning_source: { conversation: "learning-source.jsonl", task_type: "test", expected_action: "create", existing_skills: [] },
      expected_skill: {
        name_keywords: ["test"],
        trigger_keywords: ["test"],
        must_include: ["package-filtered vitest command"],
        must_not_include: ["secret"],
        expected_action: { type: "create", target_skill_id: null },
      },
      reuse: { tasks: [task.config] },
      forbidden_behaviors: ["modifies tests to force acceptance"],
    },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("self-learning-skill reuse scoring", () => {
  it("scores discovery improvement, skill loading, efficiency, and behavior adherence", async () => {
    const root = await makeTempDir();
    const withoutRoot = path.join(root, "without");
    const discoveryRoot = path.join(root, "discovery");
    const forcedRoot = path.join(root, "forced");
    await fs.mkdir(withoutRoot, { recursive: true });
    await fs.mkdir(discoveryRoot, { recursive: true });
    await fs.mkdir(forcedRoot, { recursive: true });
    await fs.writeFile(path.join(discoveryRoot, "result.txt"), "package-filtered vitest command", "utf8");
    const caseInfo = await makeCase(root);

    const result = await scoreReuseEffect({
      config: makeConfig(root),
      caseInfo,
      taskResults: [{
        taskId: "reuse-a",
        modes: {
          without_skill: makeTrial(withoutRoot, "failed"),
          with_skill_discovery: makeTrial(discoveryRoot, "passed", {
            mode: "with_skill_discovery",
            skill_installed: true,
            skill_directory_exposed: true,
            skill_loaded: true,
            skill_loads: ["project-test-command"],
            tool_calls: 5,
            token_usage: 500,
            failed_commands: 0,
          }),
          with_skill_forced: makeTrial(forcedRoot, "passed", {
            mode: "with_skill_forced",
            skill_installed: true,
            forced_skill_guidance: true,
            tool_calls: 5,
            token_usage: 500,
            failed_commands: 0,
          }),
        },
      }],
    });

    expect(result.tasks[0].scores?.task_success_delta).toBe(1);
    expect(result.tasks[0].scores?.skill_load_correctness).toBe(1);
    expect(result.tasks[0].scores?.efficiency_delta).toBeGreaterThan(0);
    expect(result.tasks[0].scores?.guidance_adherence).toBe(1);
    expect(result.total).toBeGreaterThan(0.8);
  });

  it("scores reuse regressions below neutral success delta", async () => {
    const root = await makeTempDir();
    const withoutRoot = path.join(root, "without");
    const discoveryRoot = path.join(root, "discovery");
    const forcedRoot = path.join(root, "forced");
    await fs.mkdir(withoutRoot, { recursive: true });
    await fs.mkdir(discoveryRoot, { recursive: true });
    await fs.mkdir(forcedRoot, { recursive: true });
    const caseInfo = await makeCase(root);

    const result = await scoreReuseEffect({
      config: makeConfig(root),
      caseInfo,
      taskResults: [{
        taskId: "reuse-a",
        modes: {
          without_skill: makeTrial(withoutRoot, "passed"),
          with_skill_discovery: makeTrial(discoveryRoot, "failed", { mode: "with_skill_discovery", skill_loaded: true }),
          with_skill_forced: makeTrial(forcedRoot, "failed", { mode: "with_skill_forced" }),
        },
      }],
    });

    expect(result.tasks[0].scores?.task_success_delta).toBe(0);
    expect(result.total).toBeLessThan(0.7);
  });

  it("honors expected no-load discovery tasks", async () => {
    const root = await makeTempDir();
    const withoutRoot = path.join(root, "without");
    const discoveryRoot = path.join(root, "discovery");
    await fs.mkdir(withoutRoot, { recursive: true });
    await fs.mkdir(discoveryRoot, { recursive: true });
    const caseInfo = await makeCase(root);
    caseInfo.reuseTasks[0].config.expected_skill_load = false;
    caseInfo.scenario.reuse.tasks[0].expected_skill_load = false;

    const result = await scoreReuseEffect({
      config: makeConfig(root),
      caseInfo,
      taskResults: [{
        taskId: "reuse-a",
        modes: {
          without_skill: makeTrial(withoutRoot, "passed"),
          with_skill_discovery: makeTrial(discoveryRoot, "passed", {
            mode: "with_skill_discovery",
            skill_loaded: false,
            skill_loads: [],
          }),
        },
      }],
    });

    expect(result.tasks[0].scores?.skill_load_correctness).toBe(1);
  });

  it("penalizes forbidden behavior evidence for harm avoidance", async () => {
    const root = await makeTempDir();
    const withoutRoot = path.join(root, "without");
    const discoveryRoot = path.join(root, "discovery");
    const forcedRoot = path.join(root, "forced");
    await fs.mkdir(withoutRoot, { recursive: true });
    await fs.mkdir(discoveryRoot, { recursive: true });
    await fs.mkdir(forcedRoot, { recursive: true });
    await fs.writeFile(path.join(discoveryRoot, "notes.txt"), "modifies tests to force acceptance", "utf8");
    const caseInfo = await makeCase(root);

    const result = await scoreReuseEffect({
      config: makeConfig(root),
      caseInfo,
      taskResults: [{
        taskId: "reuse-a",
        modes: {
          without_skill: makeTrial(withoutRoot, "passed"),
          with_skill_discovery: makeTrial(discoveryRoot, "passed", { mode: "with_skill_discovery", skill_loaded: true }),
          with_skill_forced: makeTrial(forcedRoot, "passed", { mode: "with_skill_forced" }),
        },
      }],
    });

    expect(result.tasks[0].scores?.harm_avoidance).toBeLessThan(1);
  });

});
