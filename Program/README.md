# Chromatopsia 开发计划

> 名字来源：王菲《色盲》—"天生这样盲目，你看了别人看不到的世界。"

## 文档索引

| 文档 | 说明 |
|------|------|
| `docs/design.md` | 完整设计文档（概念、视觉、技术细节） |
| `docs/dream.md` | 原始愿景 |
| `docs/analysis.md` | 分析笔记 |
| `agent/README.md` | Agent 层概要 + 开发状态表 |
| `agent/DESIGN.md` | Agent 层详细设计（接口、流程、代码结构） |
| `architecture/README.md` | 外围基建概要 |
| `architecture/voice-input.md` | 语音输入模块设计 |

代码在 `packages/agent/`（Agent 层）和 `packages/ui-shell/`（UI 外壳）。

---

## 核心理念

**All in One AI Coding — 最简洁的流程，最小的入侵。**

类 Claude Code 的 Coding Agent 提供深度 LLM 集成，无限画布提供多项目并行视野，悬浮窗确保随时可触及而不打断。

**让 Agent 和画布做能做的所有事情，用户不需要切换到其他应用。**

---

## 核心目标

1. **Agent** — 类 Claude Code 的终端 Agent，能在 Terminal 里完成完整开发任务
2. **画布** — 无限画布管理多项目、多 Terminal，可视化并行状态
3. **悬浮窗** — 最小化态下仍能跟进项目、决策，不打断当前工作流
4. **侧边栏** — 文件目录、Diff 视图、MD 渲染，所有查看和修改在画布内完成
5. **最小侵入** — Agent 在后台跑，用户随时瞥一眼就能处理事情

---

## 开发思路

### 分层构建

```
┌─────────────────────────────────────┐
│  UI 层（画布 + 悬浮窗）              │  ← 第二期
├─────────────────────────────────────┤
│  Agent 层（类 Claude Code）         │  ← 第一期
├─────────────────────────────────────┤
│  LLM 集成（Provider 抽象）           │  ← 第一期
└─────────────────────────────────────┘
```

**顺序**：先做 Agent 层，确保核心能力可用；再做画布/悬浮窗，用更好的形式呈现 Agent 工作状态。

---

## 组成部分

### 1. Agent 层 (`agent/`)

类 Claude Code 的终端 Agent，包含：
- 交互循环（输入 → LLM → Tool → 输出）
- 基础 Tools（Bash, Read, Edit, Grep, Glob 等）
- Approval / Human-in-the-loop
- Session 管理与上下文维护
- Tool Hooks（拦截危险操作）
- Cost Tracking

### 2. 画布层 (`architecture/`)

无限画布可视化，包含：
- 画布渲染（平移、缩放、网格）
- 项目卡片（Project Card）
- 终端面板（Terminal Panel）
- 画布布局持久化
- Canvas / 列表视图切换

### 3. 悬浮窗层 (`architecture/`)

最小化态界面，包含：
- Mini Widget
- 决策卡片（悬浮窗内处理，不弹窗打断）
- 项目进度展示
- 全局快捷键唤起

### 4. 侧边栏 (`architecture/`)

从 Codex 汲取灵感，所有查看和修改在画布内完成：
- **文件目录** — 项目文件树，点击查看
- **Diff 视图** — git diff / worktree diff，可视化变更
- **MD 渲染** — Markdown 文件直接渲染，支持编辑
- **Worktree 管理** — git worktree 的增删切换
- 用户不需要打开其他应用查看文件或 MD

---

## 一期任务（Agent 层）

**目标**：跑通一个可交互的终端 Agent

- [ ] LLM Provider 抽象（支持 Anthropic / OpenAI）
- [ ] 基础 Tools 实现（Bash, Read, Edit, Grep, Glob）
- [ ] 交互循环（REPL 模式）
- [ ] Approval 机制（危险操作前暂停等确认）
- [ ] Session 上下文管理
- [ ] Tool Hooks 系统
- [ ] 基础测试

---

## 二期任务（画布 + 悬浮窗 + 侧边栏）

**目标**：把 Agent 装进更好的 UI 里，所有查看修改在画布内完成

- [ ] 无限画布渲染
- [ ] 项目卡片 + Terminal 面板
- [ ] 画布与 Agent 的状态同步
- [ ] 悬浮窗 Mini Widget
- [ ] 悬浮窗内决策处理
- [ ] 全局快捷键唤起
- [ ] 画布布局持久化
- [ ] Canvas 视图 / 列表视图切换
- [ ] 侧边栏 — 文件目录
- [ ] 侧边栏 — Diff 视图
- [ ] 侧边栏 — MD 渲染
- [ ] 侧边栏 — Worktree 管理

---

## 未来探索（不保证实现）

- **移动端 + 电脑联动** — 手机查看 Agent 状态、发送指令给电脑上的 Agent；电脑端处理完任务推送到手机通知
- Lead Agent + Sub-Agent 协作可视化
- Activity Timeline
- RAG / 代码库上下文检索
- 团队协作 / 共享画布
