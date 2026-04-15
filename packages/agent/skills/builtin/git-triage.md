---
id: git-triage
name: Git 仓库排查
description: 快速检查仓库状态、最近提交和差异概览
triggers:
  - git 状态
  - 检查仓库
  - 仓库排查
trigger_pattern: "(git|仓库).*(状态|检查|排查)"
trigger_condition: 需要快速了解当前仓库状态
task_type: git
scope: builtin
enabled: true
priority: 80
version: 1
updated_at: 2026-04-11T00:00:00.000Z
created_at: 2026-04-11T00:00:00.000Z
call_count: 0
success_count: 0
---

## 适用场景
- 需要快速了解仓库当前状态

## 操作步骤
1. run_shell command="git --no-pager status --short"
2. run_shell command="git --no-pager log --oneline -10"
3. run_shell command="git --no-pager diff --stat"

## 注意事项
- 若仓库很大，diff 统计可能较慢
- 非 git 目录会执行失败，需要先确认工作目录

## 验证方式
- 输出包含工作树状态、最近提交和变更统计
