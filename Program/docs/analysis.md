# Claude Code 架构分析报告

> 目标：从 Claude Code 源码中提炼架构设计，为复刻项目提供分层参考。
> 分类说明：
> - **必须 (Must-Have)**：核心框架，缺少则无法构成 AI 编程代理
> - **可选 (Optional)**：可后期迭代加入，不影响基本运行
> - **亮点 (Highlight)**：差异化能力，值得重点参考

---

## 一、项目整体结构

```
src/
├── main.tsx               # 入口：React + Ink UI 启动
├── query.ts               # ★核心：Agent 循环 (async generator)
├── queryEngine.ts         # SDK 封装（无头/打印模式）
├── Tool.ts                # 工具类型定义
├── tools.ts               # 工具注册表
├── commands.ts            # 87 个斜杠命令
├── context.ts             # 系统上下文构建 (git, CLAUDE.md)
├── history.ts             # Prompt 历史管理 (jsonl)
├── Task.ts                # 后台任务抽象
├── state/                 # React 状态管理
│   ├── AppState.tsx       # 全局状态类型
│   ├── AppStateStore.tsx  # Zustand-like 存储
│   └── store.ts           # 最小响应式实现
├── tools/                 # 50+ 工具实现
├── services/
│   ├── api/               # Anthropic API 客户端
│   ├── compact/           # 上下文压缩
│   ├── mcp/               # MCP 服务器管理
│   └── analytics/         #遥测/事件
├── bridge/               # WebSocket 远程控制
├── cli/                  # CLI 输出渲染
├── ink/                  # Ink 终端 UI
├── components/            # 148 个 React/Ink 组件
└── hooks/                 # 87 个 React Hooks
```

---

## 二、必须 (Must-Have)

### 1. Agent 循环 — `query.ts`

Claude Code 的核心是 `query()` 这个 **async generator**，完整实现了以下阶段：

```
用户输入
   ↓
┌─ 预处理阶段 ──────────────────────────────────┐
│ • 微压缩 (microcompact)                       │
│ • 上下文折叠 (context collapse)               │
│ • 自动压缩检查 (autocompact)                   │
│ • 系统提示词构建 (git status, CLAUDE.md...)   │
├─ API 调用阶段 ─────────────────────────────────┤
│ • 模型流式调用 (streaming)                     │
│ • 模型降级 (fallback on error)                 │
├─ 工具执行阶段 ─────────────────────────────────┤
│ • StreamingToolExecutor 并行执行               │
│ • 权限检查 (permission)                        │
│ • 预/后置钩子 (tool hooks)                    │
├─ 恢复阶段 ─────────────────────────────────────┤
│ • 上下文折叠 drain (prompt-too-long)           │
│ • 响应式压缩重试 (reactive compact)            │
│ • 最大输出 token 升级重试                      │
└───────────────────────────────────────────────┘
   ↓
需要 Follow-up? → 继续循环 → 返回 Terminal
```

**关键设计**：使用 `async generator` 而非普通函数，使流式事件 (`StreamEvent`) 和消息 (`Message`) 能同步 yield，整个循环可中断、可恢复。

**复刻要点**：这是核心骨架，必须实现。简化版可保留：预处理 → API 调用 → 工具执行 → 循环判断。

---

### 2. 工具系统 — `Tool.ts` + `tools.ts` + `tools/`

**工具定义** (`Tool.ts`) 包含：
- `name`, `aliases` — 名称和别名
- `inputSchema` — Zod schema 验证输入
- `call()` — 异步执行函数
- `description()` — 动态描述生成
- `isConcurrencySafe` — 是否可并行
- `isReadOnly`, `isDestructive` — 行为标记
- `interruptBehavior` — 中断时行为 (`cancel` | `block`)

**工具注册** (`tools.ts`)：
- `getAllBaseTools()` — 所有内置工具（按特性门控过滤）
- `getTools(permissionContext)` — 按权限过滤
- `assembleToolPool()` — 合并内置 + MCP 工具

**核心内置工具（约 12 个）**：
| 工具 | 用途 |
|------|------|
| BashTool | Shell 命令执行 |
| FileReadTool | 读文件 |
| FileEditTool | 编辑文件（精确替换） |
| FileWriteTool | 写文件（覆盖/新建） |
| GlobTool | 文件模式匹配 |
| GrepTool | 内容搜索 |
| AgentTool | 启动子 Agent |
| TaskCreateTool / TaskOutputTool | 后台任务管理 |
| WebSearchTool / WebFetchTool | 网络搜索/抓取 |
| GlobTool / GrepTool | 代码搜索 |

**复刻要点**：Zod schema 定义输入是关键，必须实现。最小工具集 = Bash + Read + Write + Edit + Glob + Grep。

---

### 3. 状态管理 — `state/`

使用自定义响应式存储而非 Redux/Zustand：

```typescript
export type Store<T> = {
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: () => void) => void
}
```

通过 `useSyncExternalStore` 接入 React 18，支持外部修改同步。

**AppState** 包含：settings、任务状态、MCP 客户端/工具、插件状态等。

**复刻要点**：轻量级 store 足够，不需要引入重量级状态管理库。

---

### 4. 上下文构建 — `context.ts`

用户输入到达模型前，系统会构建包含以下信息的上下文：
- Git 状态（分支、变更文件、diff 摘要）
- `.claude/settings.json` 配置
- 项目级别 `.claude/project_context.md`（如存在）
- 用户提供的 CLAUDE.md 指令
- 当前工作目录信息

**复刻要点**：上下文注入是让模型理解项目状态的关键管道。最小实现 = git status + 当前目录信息。

---

### 5. 会话历史 — `history.ts` + `sessionStorage.ts`

- `history.jsonl`：Prompt 历史，限 100 条，最新优先
- 大文本粘贴（>1KB）存至粘贴存储，用哈希引用
- Session 转录存储于 `~/.claude/logs/<sessionId>.jsonl`
- 支持会话恢复 (`loadConversationForResume`)

**复刻要点**：JSONL 格式简单可靠，是最小实现的首选。

---

### 6. 权限系统 — `utils/permissions/`

`permissionMode` 设置项控制工具执行权限：
- `default` — 默认询问
- `bypassPermissions` — 完全跳过
- `acceptEdits` — 自动接受编辑
- `dontAsk` — 不询问
- `auto` — 自动判断

**复刻要点**：权限控制是安全边界，必须有。建议从简：白名单模式 + CLI 参数控制。

---

## 三、亮点 (Highlight)

以下功能是 Claude Code 的差异化竞争力，复刻时值得重点参考：

### 1. 流式工具执行 — `StreamingToolExecutor`

在模型流式输出的同时就开始执行工具（不等模型完成响应）。工具结果实时注入上下文，**大幅降低等待延迟**。这是 Claude Code 体验流畅的核心原因之一。

### 2. 上下文压缩 — `services/compact/`

当上下文接近 token 上限时：
- 自动生成对话摘要
- 用摘要替换历史消息
- 保留关键信息的同时恢复对话

Claude Code 还实现了**响应式压缩**（`REACTIVE_COMPACT`）— 收到 413 错误后自动压缩并重试。

### 3. 并行 + 分区工具执行

工具分为两类：
- **并发安全**（ReadOnly）— 多个同时执行
- **串行**（有副作用）— 按顺序执行

StreamingToolExecutor 动态调度，最大化并行度。

### 4. MCP (Model Context Protocol) 集成

Claude Code 支持加载外部 MCP 服务器作为工具来源：
- 动态发现 MCP 工具
- 统一权限控制
- 资源读取 (`ListMcpResourcesTool`)

### 5. 斜杠命令系统 — `commands.ts`

87 个斜杠命令，包括：
- `/commit` — 完整的 Git 提交流程
- `/review` — 代码审查
- `/compact` — 手动触发压缩
- `/task` — 任务管理
- `/agent` — 启动子 Agent
- `/skills` — 调用技能

命令分两类：`local`（进程内执行）和 `prompt`（展开为模型提示词）。

### 6. 子 Agent 机制 — `AgentTool`

可以嵌套启动 Agent 任务，用于分解复杂问题。每个 Agent 任务有独立 Task ID，支持：
- `TaskOutputTool` — 获取子任务结果
- `TaskStopTool` — 停止子任务
- 文件系统跟踪 (`~/.claude/tasks/`)

### 7. 远程桥接 — `bridge/`

通过 WebSocket 连接 claude.ai，支持：
- 远程控制 CLI
- 会话共享
- 事件转发

### 8. 响应式输出处理

`structuredIO.ts` 处理 SDK 的结构化输出格式，包含进度事件、工具调用事件等。

### 9. CLI UI — Ink 框架

使用 React + Ink（React reconciler for CLI）构建终端 UI：
- 148 个组件
- 支持颜色、表格、布局
- 与 React 生态无缝衔接

### 10. 特性门控系统

大量功能通过特性标志（feature gates）控制：
- `REACTIVE_COMPACT`、`CONTEXT_COLLAPSE`、`TOKEN_BUDGET` 等
- 支持 A/B 测试（GrowthBook 集成）
- `docs/feature-gates.md` 记录所有门控

---

## 四、可选 (Optional)

以下功能可作为后期迭代目标：

| 功能 | 说明 | 优先级 |
|------|------|--------|
| MCP 服务器集成 | 支持外部工具协议 | 中 |
| 子 Agent 嵌套 | 多层任务分解 | 中 |
| 会话恢复 | 跨会话继续工作 | 中 |
| 远程桥接 (WebSocket) | claude.ai 远程控制 | 低 |
| 上下文压缩 | 长对话支持 | 高（但可选简化版） |
| 斜杠命令扩展 | 87 个命令完整实现 | 低 |
| 遥测/Analytics | 事件上报和 A/B 测试 | 低 |
| Ink 终端 UI | 替代简单 stdout | 高（但可用 chalk 替代） |
| 权限提示 UI | TUI 权限确认界面 | 中 |
| 任务后台管理 | Task 持久化和追踪 | 中 |
| GrowthBook 特性门控 | 灰度发布 | 低 |
| UDS 进程通信 | 进程间通信 | 低 |

---

## 五、架构简图（复刻参考）

```
用户输入 (stdin / CLI 参数)
    │
    ▼
┌──────────────────────────────────────┐
│  Entry (main.tsx)                    │
│  • 设置加载                          │
│  • 状态初始化                        │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│  Context Builder (context.ts)        │
│  • Git 状态 / CLAUDE.md / 项目信息   │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│  Query Loop (query.ts) ★ 必须       │
│  ┌─ 预处理：compact, collapse ──────┐│
│  ├─ API 调用：streaming ───────────┤│
│  ├─ 工具执行：permission → call() ─┤│
│  └─ 循环判断：needsFollowUp? ───────┘│
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│  Tool Registry (tools.ts)            │
│  • Bash / Read / Write / Edit        │
│  • Glob / Grep / Agent              │
│  • (MCP: 可选后期)                   │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│  AppState (state/)                   │
│  • Settings / Tasks / MCP           │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│  Output (cli/ 或 chalk)              │
│  • 简单版：console.log               │
│  • 进阶版：Ink TUI                   │
└──────────────────────────────────────┘
```

---

## 六、复刻优先级建议

### 阶段一：最小可运行版本（MVP）

**必须实现**（按依赖顺序）：
1. 基础项目结构 + TypeScript 配置
2. 工具系统核心（Bash + Read + Write + Edit + Glob + Grep）
3. Agent 循环（预处理 → API 调用 → 工具执行 → 循环）
4. 上下文构建（git status + cwd）
5. 简单输出（console.log）
6. 权限基础（CLI 参数控制）
7. 会话历史（JSONL）

**预计代码量**：~2,000 行核心代码

### 阶段二：增强体验

- 流式工具执行（StreamingToolExecutor 概念）
- 上下文压缩
- CLI UI（TUI 权限提示）
- 更多斜杠命令

### 阶段三：高级功能

- MCP 集成
- 子 Agent
- 远程桥接
- 遥测/特性门控

---

## 七、关键技术选型参考

| 模块 | Claude Code 选择 | 复刻建议 |
|------|-----------------|---------|
| 入口框架 | React + Ink | 可选：chalk 或 blessed |
| API 调用 | Anthropic SDK | 必须：同款 SDK |
| 工具输入验证 | Zod | 必须 |
| 状态管理 | 自定义响应式 store | 可选：Zustand |
| 历史存储 | JSONL 文件 | 必须（同款） |
| 进程管理 | 子进程 + Task 文件 | 可选简化 |
| 通信协议 | WebSocket (桥接) | 可选后期 |
| 特性门控 | GrowthBook + 自定义 | 可选后期 |

---

*分析基于 Claude Code 源码（commit: 895221e）*
