# Chromatopsia

## 项目概述

Chromatopsia 是一款面向开发者的 Agent 编程工具，核心理念：
- **Coding Agent** — 类 Claude Code 的终端 Agent，深度整合 LLM
- **无限画布** — 多项目、多 Terminal 并行可视化
- **悬浮窗** — 最小化态下仍能跟进项目状态和决策
- **最小侵入** — Agent 在后台跑，不打断用户当前工作流

## 技术栈

- **前端**: TBD (Electron / Tauri + React)
- **Agent**: TypeScript, 基于 LLM API ( Anthropic / OpenAI / 自托管)
- **通信**: TBD

## 构建命令

TBD

## 目录结构

```
Program/
├── agent/       # Agent 层设计（核心）
├── architecture/ # 外围基建（画布、悬浮窗）

.claude/
├── memory/      # 用户偏好、项目知识
├── skills/      # Chromatopsia 专用 skill
└── prompts/     # 可复用 prompt 模板
```

## 开发原则

1. Agent 是核心，画布是外层 — 先把 Agent 调通，再做 UI
2. 最小侵入优先 — 所有设计决策以此为衡量标准
3. 文档驱动 — 设计先落文档，再动手实现
