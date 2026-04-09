# @chromatopsia/terminal

Chromatopsia Terminal REPL — Ink-based TUI for the coding agent.

## 依赖

- `@chromatopsia/agent` — Agent 核心（纯逻辑库）

## 模块

| 模块 | 说明 |
|------|------|
| `repl/slash.ts` | 斜杠命令系统（/exit /help /skills 等） |
| `repl/components/` | Ink TUI 组件（App / ConversationLog / ApprovalModal 等） |
| `repl/utils/` | Markdown → Ink 转换工具 |

详细设计文档见 `../../../Program/agent/DESIGN.md`。
