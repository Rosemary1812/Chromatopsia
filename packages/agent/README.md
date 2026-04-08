# @chromatopsia/agent

Chromatopsia Agent — 可交互的终端 Coding Agent，深度整合 LLM。

## 快速开始

```bash
pnpm install
pnpm dev
```

## 模块

| 模块 | 说明 |
|------|------|
| `llm/` | LLM Provider 抽象层（Anthropic / OpenAI） |
| `tools/` | Tool 系统（注册表 + 执行器 + 7 个内置工具） |
| `session/` | Session 管理（上下文 + 历史 + 压缩） |
| `memory/` | 跨会话记忆（JSON 文件持久化） |
| `skills/` | 自学习层（技能库 + 自动校准） |
| `hooks/` | Tool Hooks（Approval / Logging / CostTracking） |
| `repl/` | Ink TUI（双状态机 + 流式渲染） |
| `config/` | YAML 配置加载 |

详细设计文档见 `../../../Program/agent/DESIGN.md`。
