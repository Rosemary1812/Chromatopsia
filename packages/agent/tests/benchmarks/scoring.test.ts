import { describe, expect, it } from "vitest";

import { applyCostScores, scoreFoundationRun, scoreTask } from "../../../../benchmarks/scripts/utils/scoring.js";
import type { FoundationConfig, FoundationRunResult } from "../../../../benchmarks/scripts/utils/types.js";

function makeConfig(): FoundationConfig {
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
      fixtures_root: "benchmarks/fixtures/foundation",
      runs_root: "benchmarks/runs",
      reports_root: "benchmarks/reports",
    },
    scoring: {
      enabled_metrics: ["B1", "B3", "B5"],
      weights: {
        B1: 0.6,
        B2: 0.1,
        B3: 0.3,
        B4: 0,
        B5: 0.1,
        B6: 0,
      },
      cost_weights: {
        tool_calls: 0.5,
        duration_ms: 0.2,
        token_usage: 0.2,
        redundant_reads: 0.1,
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

function makeRunResult(): FoundationRunResult {
  return {
    meta: {
      run_id: "run-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      duration_seconds: 10,
      model: "openai:gpt-5.4-mini",
      total_tasks: 2,
      status: "completed",
    },
    tasks: [
      {
        id: "task-1",
        category: "bug-fix",
        workspace_path: "/tmp/task-1",
        trace_path: "/tmp/task-1.trace",
        agent_task_root: "/tmp/task-1.agent",
        agent_config_path: "/tmp/task-1.agent/config.yaml",
        agent_session_id: "session-1",
        title: "Task 1",
        task_description: "Task 1 description",
        status: "passed",
        acceptance_passed: 2,
        acceptance_total: 2,
        quality_passed: 1,
        quality_total: 1,
        duration_ms: 100,
        token_usage: 50,
        tool_calls: 1,
        approval_requests: 1,
        compressed_turns: 0,
        must_read_files: ["src/main.py"],
        llm_context_questions: [],
        compression_key_facts: [],
        dangerous_operations: [],
        errors: [],
        acceptance_checks: [],
        quality_gate_checks: [],
      },
      {
        id: "task-2",
        category: "bug-fix",
        workspace_path: "/tmp/task-2",
        trace_path: "/tmp/task-2.trace",
        agent_task_root: "/tmp/task-2.agent",
        agent_config_path: "/tmp/task-2.agent/config.yaml",
        agent_session_id: "session-2",
        title: "Task 2",
        task_description: "Task 2 description",
        status: "failed",
        acceptance_passed: 1,
        acceptance_total: 2,
        quality_passed: 0,
        quality_total: 1,
        duration_ms: 200,
        token_usage: 100,
        tool_calls: 4,
        approval_requests: 2,
        compressed_turns: 0,
        must_read_files: ["src/main.py"],
        llm_context_questions: [],
        compression_key_facts: [],
        dangerous_operations: [],
        errors: [],
        acceptance_checks: [],
        quality_gate_checks: [],
      },
    ],
  };
}

describe("benchmark scoring", () => {
  it("uses config-driven cost weights and enabled metrics", () => {
    const config = makeConfig();
    const result = makeRunResult();

    const task1 = scoreTask(result.tasks[0], {
      traceEvents: [
        { ts: "", run_id: "run-1", suite: "foundation", task_id: "task-1", event_type: "file_read", file_path: "src/main.py" },
        { ts: "", run_id: "run-1", suite: "foundation", task_id: "task-1", event_type: "approval_requested" },
        { ts: "", run_id: "run-1", suite: "foundation", task_id: "task-1", event_type: "approval_resolved", decision: "approve" },
      ],
      sessionMessages: [],
      contextJudge: { score: 8, reason: "good" },
      compressionJudge: null,
    });

    const task2 = scoreTask(result.tasks[1], {
      traceEvents: [
        { ts: "", run_id: "run-1", suite: "foundation", task_id: "task-2", event_type: "file_read", file_path: "src/main.py" },
        { ts: "", run_id: "run-1", suite: "foundation", task_id: "task-2", event_type: "file_read", file_path: "src/main.py" },
        { ts: "", run_id: "run-1", suite: "foundation", task_id: "task-2", event_type: "approval_requested" },
      ],
      sessionMessages: [],
      contextJudge: { score: 4, reason: "weak" },
      compressionJudge: null,
    });

    const costScoredTasks = applyCostScores(config, [task1, task2]);
    const scored = scoreFoundationRun(config, result, costScoredTasks);

    expect(costScoredTasks[0]?.scores.cost).toBeGreaterThan(costScoredTasks[1]?.scores.cost ?? 1);
    expect(costScoredTasks[0]?.scores.cost).toBe(0.675);
    expect(costScoredTasks[1]?.scores.cost).toBeCloseTo(0, 10);
    expect(scored.summary.enabled_metrics).toEqual(["B1", "B3", "B5"]);
    expect(scored.summary.applied_weights).toEqual({ B1: 0.6, B3: 0.3, B5: 0.1 });
    expect(scored.summary.B1_completion).toBe(0.75);
    expect(scored.summary.B5_safety).toBe(0.5);
    expect(scored.summary.total_score).toBeCloseTo(0.60125, 5);
  });
});
