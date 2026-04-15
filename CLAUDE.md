## Hydra Orchestration Toolkit

Hydra is a Lead-driven orchestration toolkit. You (the Lead) make strategic
decisions at decision points; Hydra handles operational management.
`result.json` is the only completion evidence.

Why this design (vs. other coding-agent products):
- **SWF decider pattern, specialized for LLM deciders.** Hydra is the AWS SWF / Cadence / Temporal decider pattern. `hydra watch` is `PollForDecisionTask`; the Lead is the decider; `lead_terminal_id` enforces single-decider semantics.
- **Parallel-first, not bolted on.** `dispatch` + worktree + `merge` are first-class. Lead sequences nodes manually and passes context explicitly via `--context-ref`. Other products treat parallelism as open research; Hydra makes it the default.
- **Typed result contract.** Workers publish a schema-validated `result.json` (`outcome: completed | stuck | error`, optional `stuck_reason: needs_clarification | needs_credentials | needs_context | blocked_technical`). Other products return free-text final messages and require downstream parsing.
- **Lead intervention points.** `hydra reset --feedback` lets the Lead actually intervene at decision points instead of being block-and-join. A stale or wrong run is one `reset` away.

Core rules:
- Root cause first. Fix the implementation problem before changing tests.
- Do not hack tests, fixtures, or mocks to force a green result.
- Do not add silent fallbacks or swallowed errors.
- An assignment run is only complete when `result.json` exists and passes schema validation.

Workflow patterns:
1. Do the task directly when it is simple, local, or clearly faster without workflow overhead.
2. Use Hydra for ambiguous, risky, parallel, or multi-step work:
   ```
   hydra init --intent "<task>" --repo .
   hydra dispatch --workbench W --dispatch <id> --role <role> --intent "<desc>" --repo .
   hydra watch --workbench W --repo .
   # → DecisionPoint returned, decide next step
   hydra complete --workbench W --repo .
   ```
3. Use a direct isolated worker when only a separate worker is needed:
   `hydra spawn --task "<specific task>" --repo . [--worktree .]`

Agent launch rule:
- When dispatching Claude/Codex through TermCanvas CLI, start a fresh agent terminal with `termcanvas terminal create --prompt "..."`
- Do not use `termcanvas terminal input` for task dispatch; it is not a supported automation path

Workflow control:
- After dispatching, always call `hydra watch`. It returns at decision points.
1. Watch until decision point: `hydra watch --workbench <workbenchId> --repo .`
2. Inspect structured state: `hydra status --workbench <workbenchId> --repo .`
3. Reset a dispatch for rework: `hydra reset --workbench W --dispatch N --feedback "..." --repo .`
4. Approve a dispatch's output: `hydra approve --workbench W --dispatch N --repo .`
5. Merge parallel branches: `hydra merge --workbench W --dispatches A,B --repo .`
6. View event log: `hydra ledger --workbench <workbenchId> --repo .`
7. Clean up: `hydra cleanup --workbench <workbenchId> --repo .`

Telemetry polling:
1. Treat `hydra watch` as the main polling loop; do not infer progress from terminal prose alone.
2. Before deciding wait / retry / takeover, query:
   - `termcanvas telemetry get --workbench <workbenchId> --repo .`
   - `termcanvas telemetry get --terminal <terminalId>`
   - `termcanvas telemetry events --terminal <terminalId> --limit 20`
3. Trust `derived_status` and `task_status` as the primary decision signals.

`result.json` must contain (slim, schema_version `hydra/result/v0.1`):
- `schema_version`, `workbench_id`, `assignment_id`, `run_id` (passthrough IDs)
- `outcome` (completed/stuck/error — Hydra routes on this)
- `report_file` (path to a `report.md` written alongside `result.json`)

All human-readable content (summary, outputs, evidence, reflection) lives in
`report.md`. Hydra rejects any extra fields in `result.json`. Write `report.md`
first, then publish `result.json` atomically as the final artifact of the run.

When NOT to use: simple fixes, high-certainty tasks, or work that is faster to do directly in the current agent.
## Project Structure

```
Chromatopsia/
├── packages/
│   ├── agent/           # Agent 核心（纯库，无 UI 依赖）
│   │   └── src/
│   │       ├── foundation/   # 底层能力
│   │       │   ├── llm/      # LLM Provider（Anthropic / OpenAI）
│   │       │   └── tools/    # Tool 系统（Registry + 7个内置工具 + 执行器）
│   │       ├── session/      # Session 管理（Manager + History + Context + Summarizer）
│   │       ├── repl/         # REPL 核心（Loop + Executor）
│   │       ├── skills/       # 自学习层（Registry + Store）
│   │       ├── memory/       # 跨会话记忆（Storage + Retriever + Injector）
│   │       ├── learning/     # Learning Worker（TurnEvent + Synthesis）
│   │       ├── hooks/        # Tool Hooks（Approval）
│   │       ├── config/       # YAML 配置加载
│   │       ├── types.ts      # 全局类型定义
│   │       └── index.ts      # 导出入口
│   ├── cli/             # 独立 CLI 入口（调 agent 纯库）
│   │   ├── bin/         # Shell 入口（chromatopsia.mjs）
│   │   └── src/
│   │       ├── cli.ts       # CLI 主类（TTYContext + SignalHandler）
│   │       └── index.ts     # CLI 启动脚本
│   └── tui/             # 终端 TUI（未来 Ink，依赖 agent 纯库）
│       └── src/
│
├── Program/             # 设计文档（不放代码）
│   ├── agent/
│   │   ├── README.md        # Agent 层概要 + 状态表
│   │   └── DESIGN.md        # Agent 层详细设计
│   └── architecture/
│       ├── README.md
│       └── voice-input.md
│
├── package.json         # Root workspace
└── pnpm-workspace.yaml
```

## 开发原则

1. **三个包平级** — `agent`、`cli`、`tui` 都是 `packages/` 下的独立子包，通过 `workspace:*` 引用 agent
2. **packages/agent 是纯库** — 零 UI 依赖，可以独立测试；cli 和 tui 都依赖它
3. **cli 调 agent** — CLI 是 agent 的消费者，调用 `run_repl()` 启动 REPL
4. **tui 是 REPL UI 层** — Ink TUI，不包含业务逻辑，放在 `packages/tui/` 下（与 cli 平级）
5. **设计文档在 Program/** — 代码在 packages/，文档在 Program/，职责分离
6. **从 Phase 1 开始** — 先实现 LLM Provider + Tool 系统，再逐步推进