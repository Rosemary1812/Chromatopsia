## Hydra Sub-Agent Tool

Classify the task before choosing a mode. Hydra is for file-driven
orchestration, not the default path for every change.
Hydra treats `result.json` + `done` as the only completion evidence.
Terminal conversation is not a source of truth.

Core rules:
- Root cause first. Fix the implementation problem before changing tests.
- Do not hack tests, fixtures, or mocks to force a green result.
- Do not add silent fallbacks or swallowed errors.
- A handoff is only complete when both `result.json` and `done` exist and pass schema validation.

Workflow patterns:
1. Do the task directly when it is simple, local, or clearly faster without workflow overhead.
2. Use a single implementer workflow when you still want Hydra evidence and retry control:
   `hydra run --task "<specific task>" --repo . --template single-step [--worktree .]`
3. Use the default planner -> implementer -> evaluator workflow for ambiguous, risky, or PRD-driven work:
   `hydra run --task "<specific task>" --repo . [--worktree .]`
   - If the user says all roles should use one provider, pass `--all-type <provider>`.
   - If the user wants a mix, pass `--planner-type`, `--implementer-type`, and `--evaluator-type`.
   - If the user does not specify providers, Hydra should prefer the current terminal's provider when available.
4. Use a direct isolated worker primitive when the split is already known and you do not need a full workflow:
   `hydra spawn --task "<specific task>" --repo . [--worktree .]`

Agent launch rule:
- When dispatching Claude/Codex through TermCanvas CLI, start a fresh agent terminal with `termcanvas terminal create --prompt "..."`
- Do not use `termcanvas terminal input` for task dispatch; it is not a supported automation path

Workflow control:
- After `hydra run` or `hydra spawn`, immediately start polling with `hydra watch`. Do not ask whether to watch — always watch.
1. Inspect one-shot progress: `hydra tick --repo . --workflow <workflowId>`
2. Watch until terminal state: `hydra watch --repo . --workflow <workflowId>`
3. Inspect structured state and failures: `hydra status --repo . --workflow <workflowId>`
4. Retry a failed/timed-out workflow when allowed: `hydra retry --repo . --workflow <workflowId>`
5. Clean up runtime state or worktrees: `hydra cleanup --workflow <workflowId> --repo .`

Telemetry polling:
1. Treat `hydra watch` as the main-brain polling loop; do not infer progress from terminal prose alone.
2. Before deciding wait / retry / takeover, query:
   - `termcanvas telemetry get --workflow <workflowId> --repo .`
   - `termcanvas telemetry get --terminal <terminalId>`
   - `termcanvas telemetry events --terminal <terminalId> --limit 20`
3. Trust `derived_status` and `task_status` as the primary decision signals. Only investigate further when both indicate a problem.
4. Keep waiting when `derived_status=progressing` or `task_status=running`.
5. Treat `awaiting_contract` as "turn complete, file contract still pending".
6. Treat `stall_candidate` as "investigate before retry", not automatic failure. Query recent telemetry events to confirm the agent is truly stuck.
7. Treat `error` as "agent hit an API error". Check `last_hook_error`: `rate_limit`/`server_error` → wait and retry; `billing_error`/`authentication_failed` → stop; `max_output_tokens` → retry with compact; `invalid_request` → stop and investigate.

Worker control:
1. List direct workers: `hydra list --repo .`
2. Clean up a direct worker: `hydra cleanup <agentId>`

`result.json` must contain:
- `success`
- `summary`
- `outputs[]`
- `evidence[]`
- `next_action`

When NOT to use: simple fixes, high-certainty tasks, or work that is faster to do directly in the current agent.
## Project Structure

```
Chromatopsia/
├── packages/
│   ├── agent/           # Agent 核心（纯库，无 UI 依赖）
│   │   └── src/
│   │       ├── types.ts    # 全局类型定义
│   │       ├── index.ts    # 导出入口
│   │       ├── llm/        # LLM Provider（Anthropic / OpenAI）
│   │       ├── tools/      # Tool 系统（Registry + 7个内置工具 + 执行器）
│   │       ├── session/    # Session 管理（Manager + History + Context + Summarizer）
│   │       ├── memory/     # 跨会话记忆（Storage + Retriever + Injector）
│   │       ├── skills/     # 自学习层（Registry + Patcher）
│   │       ├── hooks/      # Tool Hooks（Approval + Logging + CostTracking）
│   │       ├── repl/       # REPL 核心（Loop + Reflection + Executor）
│   │       ├── config/     # YAML 配置加载
│   │   └── tui/          # 终端 TUI（Ink，依赖 agent）
│   │       ├── src/
│   │       │   ├── index.ts
│   │       │   └── repl/
│   │       │       ├── slash.ts      # 斜杠命令系统
│   │       │       ├── components/    # Ink 组件
│   │       │       └── utils/         # Markdown → Ink 转换
│   │       └── package.json
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

1. **Agent 核心先行** — Phase 1 专注于 Agent 调通，TUI 是后话
2. **packages/agent 是纯库** — 无 UI 依赖，可以独立测试；TUI 依赖它
3. **tui 是 REPL UI 层** — Ink TUI，依赖 agent；不包含业务逻辑，放在 agent/tui/ 下
4. **设计文档在 Program/** — 代码在 packages/，文档在 Program/，职责分离
5. **从 Phase 1 开始** — 先实现 LLM Provider + Tool 系统，再逐步推进