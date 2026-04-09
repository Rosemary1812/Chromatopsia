# Chromatopsia Agent 开发 SOP — 详细工作流

## 上下文要求

开始前必须完整阅读（按顺序）：
1. `plan.md` — 26 个任务的拆分与验证指南路径
2. `collaboration.md` — 协作流程，commit 格式、分支策略
3. `Program/agent/README.md` — Agent 层架构总览
4. `Program/agent/DESIGN.md` — Agent 层详细设计，接口定义、数据结构、交互流程

---

## 26 个任务清单

| 任务 | 核心文件 | 所属 Phase |
|------|---------|-----------|
| T-00 | `packages/agent/src/types.ts` + `index.ts` | Phase 0 |
| T-01 | `packages/agent/src/config/loader.ts` | Phase 1 |
| T-02 | `packages/agent/src/llm/provider.ts` | Phase 1 |
| T-03 | `packages/agent/src/llm/index.ts` | Phase 1 |
| T-04 | `packages/agent/src/llm/anthropic.ts` | Phase 1 |
| T-05 | `packages/agent/src/llm/openai.ts` | Phase 1 |
| T-06 | `packages/agent/src/tools/registry.ts` | Phase 2 |
| T-07 | `packages/agent/src/tools/executor.ts` | Phase 2 |
| T-08 | `packages/agent/src/tools/bash.ts` | Phase 2 |
| T-09 | `packages/agent/src/tools/read.ts` | Phase 2 |
| T-10 | `packages/agent/src/tools/edit.ts` | Phase 2 |
| T-11 | `packages/agent/src/tools/grep.ts` + `glob.ts` | Phase 2 |
| T-12 | `packages/agent/src/tools/websearch.ts` | Phase 2 |
| T-13 | `packages/agent/src/tools/webfetch.ts` | Phase 2 |
| T-14 | `packages/agent/src/session/history.ts` | Phase 3 |
| T-15 | `packages/agent/src/session/context.ts` | Phase 3 |
| T-16 | `packages/agent/src/session/summarizer.ts` | Phase 3 |
| T-17 | `packages/agent/src/session/manager.ts` | Phase 3 |
| T-18 | `packages/agent/src/memory/storage.ts` | Phase 4 |
| T-19 | `packages/agent/src/skills/registry.ts` + `patcher.ts` | Phase 4 |
| T-20 | `packages/agent/src/hooks/approval.ts` | Phase 5 |
| T-21 | `packages/agent/src/repl/reflection.ts` | Phase 6 |
| T-22 | `packages/agent/src/repl/slash.ts` | Phase 6 |
| T-23 | `packages/agent/src/repl/executor.ts` | Phase 6 |
| T-24 | `packages/agent/src/repl/loop.ts` | Phase 6 |
| T-25 | `packages/agent/src/repl/components/` + `utils/` | Phase 6 |
| T-26 | 端到端集成验证 | Phase 7 |

---

## 开始前：同步 main

```bash
git checkout main
git pull origin main
git checkout -b phase{X}
```

例如 Phase 1：`git checkout -b phase1`

---

## 每个任务的标准流程（Step 1~5）

### Step 1：读取验证指南

你的任务对应的验证指南：
```
packages/agent/verification/{序号}-{名字}.md
```

例如 T-01：`packages/agent/verification/01-config.md`

先读一遍，确认预期行为和验证步骤。

### Step 2：实现代码

按 `plan.md` + `Program/agent/DESIGN.md` 的要求实现。

**核心原则**：
- **不要改 `types.ts`**（T-00 已固定）
- **不要改 `index.ts`**（T-00 已固定）
- **不要改其他 agent 负责的文件**
- Placeholder 文件已存在（`throw new Error('Not implemented yet')`），直接覆盖实现即可

### Step 3：写单测

```
packages/agent/tests/{模块名}.test.ts
```

使用 `vitest` 测试框架（参考 `packages/agent/vitest.config.ts`）。

### Step 4：编译 + 测试

```bash
cd packages/agent
pnpm build
pnpm test
```

两者都必须通过，**不准在失败状态下提交**。

### Step 5：报告完成

向用户报告：
```
[Phase X] 实现完成
包含任务：T-XX ~ T-XX
验证指南：packages/agent/verification/
```

等待用户执行人工验证。

---

## Commit 格式

收到用户「✅ Phase X 验证通过」后，执行：

```bash
git add .
git commit -m "$(cat <<'EOF'
feat(agent): {简短描述}

{详细说明（可选）}

Co-Authored-By: Claude <noreply@anthropic.com>
Verified by: human
Phase: X
EOF
)"
git push -u origin phase{X}
```

---

## 分支合并流程（全程 Terminal）

使用 GitHub CLI (`gh`)，无需打开浏览器：

```bash
# 1. 推送分支
git push -u origin phase{X}

# 2. 创建 PR
gh pr create \
  --title "feat(agent): implement Phase {X}" \
  --body "$(cat <<'EOF'
## Summary
- {简述实现内容}

## Test plan
- [ ] pnpm build && pnpm test passes locally
- [ ] Manual verification by human

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# 3. 合并 PR（squash merge）
gh pr merge --admin --squash
```

**合并后必须更新 `plan.md`**：将对应 Phase 的所有任务 `[ ]` 改为 `[x]`。

---

## 并行分发建议

每个 Phase 作为一个分支，Phase 内的任务可并行分发：

| 窗口 | 分配 Phase | 任务范围 |
|------|-----------|---------|
| 窗口 1 | Phase 0 | T-00（types + index 导出） |
| 窗口 2 | Phase 1 | T-01 ~ T-05 |
| 窗口 3 | Phase 2 | T-06 ~ T-13 |
| 窗口 4 | Phase 3 | T-14 ~ T-17 |
| 窗口 5 | Phase 4 | T-18 ~ T-19 |
| 窗口 6 | Phase 5 | T-20 |
| 窗口 7 | Phase 6 | T-21 ~ T-25 |
| 窗口 8 | Phase 7 | T-26（集成验证） |

每个窗口各自基于最新 main 创建 `phase{X}` 分支，独立开发同一 Phase 内的多个任务。

---

## 禁止事项

- ❌ 不准在未确认的情况下 merge 到 main
- ❌ 不准改 `types.ts` 或 `index.ts`
- ❌ 不准改其他 agent 负责的文件
- ❌ 不准 push 有编译错误或测试失败的代码
- ❌ 不准跳过 `pnpm build && pnpm test` 直接提交
