---
name: agent-build-sop
description: Chromatopsia Agent 开发 SOP。当用户说"开始 Phase X"、"分发任务"、"并行开发"、"分配给其他 agent"、"新建分支做 T-XX"、"按 SOP 工作"、"工作流程"、"任务分配"，或者要求查看任何 Phase（Phase 0~9）的工作指南时，必须触发此 skill。
---

# Chromatopsia Agent 开发 SOP

Chromatopsia Agent 层 26 个任务（Phase 0~9）的标准化并行开发工作流程。

详细执行步骤见 `references/workflow.md`。

## 触发判断

| 用户说了什么 | 执行动作 |
|---|---|
| 开始 Phase X / 开始 T-XX | 创建分支 + 按 SOP 执行 |
| 分发任务给其他 agent | 展示 SOP + 分配方式 |
| 查看工作流程 / SOP | 展示 SOP 摘要 |
| 并行开发 | 说明如何开多个窗口 |

## 执行规则

1. **先同步 main**：每个新分支基于最新 main 创建
2. **每个任务独立**：同 Phase 任务可并行，互不干扰
3. **验证通过才 commit**：必须等用户确认「✅ T-XX」再 push
4. **不改 types.ts / index.ts**：T-00 阶段已固定
5. **不跨文件修改**：每个文件只有一个 owner agent

## 加载详细 SOP

```
请读取 references/workflow.md，然后按照其中的步骤执行。
```
