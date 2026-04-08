# 协作流程

## 角色分工

| 角色 | 职责 |
|------|------|
| **Human（你）** | 协调者 — 分配任务、审核验证结果、触发 commit |
| **Claude Code** | 工作者 — 实现代码、编写验证指南、执行 commit |

---

## 任务分配规则

### 1. types.ts 优先

先完成 **T-00（types.ts）**，所有后续任务才能并行。
- 你告诉我要做 T-00
- 我完成后写好验证指南
- 你验证 → 口头确认"✅ T-00 通过"
- 我 commit + push
- 之后才能开始 Phase 1 的其他任务

### 2. types.ts 完成后，Phase 1 可全部并行

Phase 1（T-01 ~ T-05）共 5 个任务，可以同时分配给 5 个 Claude Code 实例。
- 你告诉每个实例分别做哪个任务
- 每个实例独立工作，独立验证
- 你确认每个通过后，分别 commit

### 3. 文件归属原则

**每个文件只能被一个 agent 拥有**，不能跨 agent 修改同一文件。

唯一例外：`index.ts` 在 T-26（集成阶段）由负责集成的 agent 统一写入。

---

## 标准工作流（每个任务重复此流程）

```
Human 分配任务
    ↓
Claude Code 实现代码 + 写单测
    ↓
Claude Code 编写 verification/XX-name.md
    ↓
Claude Code 报告完成，附上验证指南路径
    ↓
Human 读取验证指南，执行人工验证
    ↓
Human 口头确认结果：
  ✅ T-XX 验证通过        → Claude Code git commit + push
  ❌ T-XX 有问题，[描述]  → Claude Code 修复，重试
```

---

## Git 分支策略

每个任务一个分支，命名格式：`{phase}/{task-id}-{name}`

```
main
└── t00-types          ──merge──→ main
└── t01-config         ──merge──→ main
└── t02-provider       ──merge──→ main
└── t03-llm-index      ──merge──→ main
└── t04-anthropic      ──merge──→ main
└── t05-openai         ──merge──→ main
...
└── t26-integration    ──merge──→ main
```

**分支合并顺序**：
1. main 永远只通过 merge 更新，不在 main 上直接 commit
2. 每个任务分支基于当前 main 创建
3. 验证通过后，merge 到 main
4. 下一个任务分支基于新的 main 创建

---

## commit 消息格式

```
feat(agent): {简短描述}

{详细说明（可选）}

Verified by: human
Task: T-XX
```

示例：
```
feat(agent): implement types.ts global type definitions

Co-Authored-By: Claude <noreply@anthropic.com>
Verified by: human
Task: T-00
```

---

## 多 agent 并行时的注意事项

### 你告诉我的格式

```
[Task T-XX] 开始实现 {任务名}
[Task T-XX] 验证指南已写好，请审阅
✅ T-XX 验证通过
❌ T-XX 有问题：{问题描述}
```

### 我向 GitHub 推送的时机

只在收到你明确"✅ T-XX 验证通过"之后才推送，不会在验证通过前 push。

### 冲突预防

types.ts（T-00）是唯一一个在并行阶段之前必须完成的任务。Phase 1 起的所有任务只 import types.ts，不改 types.ts。

---

## 验证指南格式模板

```markdown
# T-XX：{任务名} 人工验证指南

## 验证目标
{一句话说明这个模块做什么}

## 验证前置条件
- Node.js >= 20
- pnpm install 已执行
- 环境变量已配置（如需要 API Key）

## 验证步骤

### 步骤 1：{子目标}
```bash
{执行的命令}
```
**预期结果**：{描述预期输出}

### 步骤 2：{子目标}
...

## 边界情况

- {边界场景}：{预期行为}

## 验证通过标准

- [ ] 步骤 1 符合预期
- [ ] 步骤 2 符合预期
- [ ] 边界情况处理正确
- [ ] TypeScript 编译无错误（`pnpm build`）
- [ ] 单测全部通过（`pnpm test`）

## 注意事项
{如有需人工注意的点}
```

---

## 如何开始

1. 阅读 `plan.md`，确认任务拆分
2. 阅读 `collaboration.md`，确认流程
3. 告诉我：**"开始 T-00"**

---

## 当前任务状态

| 任务 | 状态 | 验证指南 |
|------|------|---------|
| T-00 types.ts | ⬜ 待开始 | — |
| T-01 config | ⬜ 待开始 | — |
| T-02 llm-provider | ⬜ 待开始 | — |
| T-03 llm-index | ⬜ 待开始 | — |
| T-04 anthropic | ⬜ 待开始 | — |
| T-05 openai | ⬜ 待开始 | — |
| T-06 registry | ⬜ 待开始 | — |
| T-07 executor | ⬜ 待开始 | — |
| T-08 bash | ⬜ 待开始 | — |
| T-09 read | ⬜ 待开始 | — |
| T-10 edit | ⬜ 待开始 | — |
| T-11 grep/glob | ⬜ 待开始 | — |
| T-12 websearch | ⬜ 待开始 | — |
| T-13 webfetch | ⬜ 待开始 | — |
| T-14 session-history | ⬜ 待开始 | — |
| T-15 session-context | ⬜ 待开始 | — |
| T-16 session-summarizer | ⬜ 待开始 | — |
| T-17 session-manager | ⬜ 待开始 | — |
| T-18 memory-storage | ⬜ 待开始 | — |
| T-19 skills | ⬜ 待开始 | — |
| T-20 approval | ⬜ 待开始 | — |
| T-21 reflection | ⬜ 待开始 | — |
| T-22 slash | ⬜ 待开始 | — |
| T-23 repl-executor | ⬜ 待开始 | — |
| T-24 repl-loop | ⬜ 待开始 | — |
| T-25 repl-components | ⬜ 待开始 | — |
| T-26 integration | ⬜ 待开始 | — |
