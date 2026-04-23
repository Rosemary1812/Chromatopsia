# Benchmarks

This directory contains repository-level benchmark infrastructure for Chromatopsia.

## Principles

- `fixtures/` is read-only source data.
- Real task execution happens only in `runs/<run_id>/.../workspaces/`.
- `reports/` stores finalized benchmark outputs.
- Foundation benchmarking is the only active implementation scope right now.
- Skill Learning is intentionally split out and kept as a TODO-only skeleton; future evaluation should judge guidance quality, not macro replay.

## Current Scope

- Foundation benchmark is implemented end to end:
  - fixture validation
  - run workspace creation
  - isolated agent execution
  - trace capture
  - scoring
  - baseline JSON/HTML reporting
- Skill Learning remains design-only and is not part of runner, scoring, or reports. Its eventual target is `SKILL.md` guidance quality and usefulness after loading through the Skill tool.
- Current fixture inventory is 12 foundation tasks across bug-fix, feature, refactor, and devops.

## Config Inheritance

Benchmark agent execution inherits the existing agent configuration by default instead of rebuilding provider settings from scratch.

Resolution order:

1. `CHROMATOPSIA_BENCHMARK_AGENT_CONFIG`
2. The normal repository config resolution chain
3. `packages/agent/config.yaml`

Benchmark then applies only the overrides required for isolated evaluation:

- task-local `storage`
- benchmark `approval` defaults
- `learning.enabled = false`
- task/session isolation settings
- benchmark model name and `max_tokens`

This keeps provider, auth, base URL, and other environment-specific behavior aligned with the agent configuration you already use in normal development.

## Commands

- `pnpm benchmark:validate-fixtures`
- `pnpm benchmark:foundation`
- `pnpm benchmark:score -- --run=<run_id>`
- `pnpm benchmark:report -- --run=<run_id>`

## Run Artifacts

- `benchmarks/runs/<run_id>/foundation/result.json`
  Raw foundation execution result for the run.
- `benchmarks/runs/<run_id>/foundation/scored.json`
  Scored foundation result after `benchmark:score`.
- `benchmarks/runs/<run_id>/foundation/traces/<task_id>.jsonl`
  Structured per-task execution trace.
- `benchmarks/runs/<run_id>/foundation/tasks/<task_id>/`
  Task-local agent config and isolated `.chromatopsia` state.
- `benchmarks/reports/foundation-*.json`
  Archived scored report output.
- `benchmarks/reports/dashboard-*.html`
  Baseline HTML rendering of the scored report.

## Directory Layout

```text
benchmarks/
├── configs/
├── fixtures/
├── reports/
├── runs/
├── scripts/
└── templates/
```
