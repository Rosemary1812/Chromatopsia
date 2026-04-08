# Agent 层设计

本目录是 **Chromatopsia 的核心** — 可交互的终端 Coding Agent，深度整合 LLM。

---

## 目标

**Phase 1**：跑通一个可交互的终端 Agent

```
用户输入
   ↓
REPL 循环（read-eval-print loop）
   ├── 接收用户消息
   ├── 调用 LLM（携带工具描述 + 上下文）
   ├── LLM 返回 Tool Use 请求
   ├── 执行 Tool，返回结果
   └── 循环直到 LLM 输出最终回复
```

---

## 架构总览

```
Agent
├── LLM Provider 层
│   ├── Anthropic（Tool Use）
│   ├── OpenAI（Function Calling）
│   └── 自定义 Provider 扩展
│
├── Tool 系统
│   ├── Tool Registry（注册中心）
│   ├── 并行 Executor（safe 并行，warning/dangerous 串行）
│   ├── Zod 参数校验
│   ├── 内置 Tools：Bash, Read, Edit, Grep, Glob
│   └── Tool Hooks（执行前/后/错误拦截）
│
├── 自学习层
│   ├── Skill Registry（按需加载，渐进披露）
│   ├── Skill Patcher（使用中自动校准）
│   ├── Reflection 状态机（自动生成新技能）
│   └── Cross-Session Memory（JSON 文件 + 内存缓存）
│
├── Session Manager（上下文管理）
│   ├── conversation history（消息历史）
│   ├── 上下文压缩（自动摘要）
│   └── system prompt（项目/用户上下文）
│
├── Approval 机制（Human-in-the-Loop）
│   ├── 危险操作识别
│   ├── 异步等待确认
│   └── 决策回传
│
└── REPL（TUI 入口 — Ink）
    ├── 双状态机（Normal + Reflection）
    ├── 斜杠命令系统
    ├── Ink 组件层（流式渲染 / Approval 弹窗 / 工具状态）
    └── 命令行参数解析
```

---

## 目录结构

```
Program/agent/
├── README.md              ← 本文件
├── DESIGN.md              ← 详细设计文档
├── src/
│   ├── index.ts           ← 导出入口
│   ├── types.ts           ← 共享类型定义
│   ├── llm/
│   │   ├── provider.ts    ← LLM Provider 抽象接口
│   │   ├── anthropic.ts   ← Anthropic Provider
│   │   └── openai.ts      ← OpenAI Provider
│   ├── tools/
│   │   ├── registry.ts    ← Tool 注册表
│   │   ├── bash.ts        ← Bash Tool
│   │   ├── read.ts        ← Read Tool
│   │   ├── edit.ts        ← Edit Tool
│   │   ├── grep.ts        ← Grep Tool
│   │   ├── glob.ts        ← Glob Tool
│   │   └── executor.ts    ← Tool 执行器（含并行/Zod 校验）
│   ├── session/
│   │   ├── manager.ts     ← Session 管理器
│   │   ├── context.ts     ← 上下文构建管道
│   │   ├── history.ts     ← Session 持久化（JSONL）
│   │   └── summarizer.ts  ← 长对话自动压缩（LLM 摘要）
│   ├── memory/
│   │   ├── storage.ts     ← JSON 文件持久化
│   │   ├── retriever.ts   ← 跨会话检索
│   │   └── injector.ts   ← 上下文注入策略
│   ├── skills/
│   │   ├── registry.ts    ← 技能库（按需加载）
│   │   └── patcher.ts     ← 使用中自动 patch
│   ├── hooks/
│   │   ├── index.ts       ← Hooks 入口
│   │   └── approval.ts    ← Approval 机制（异步）
│   ├── repl/
│   │   ├── loop.ts        ← REPL 主循环（双状态机）
│   │   ├── reflection.ts  ← 反思状态机（技能生成）
│   │   ├── slash.ts       ← 斜杠命令系统
│   │   ├── executor.ts    ← 并行 Tool 执行
│   │   ├── app.tsx        ← Ink 应用入口
│   │   ├── components/    ← Ink TUI 组件
│   │   │   ├── App.tsx
│   │   │   ├── ConversationLog.tsx
│   │   │   ├── UserMessage.tsx
│   │   │   ├── AssistantMessage.tsx
│   │   │   ├── StreamingOutput.tsx
│   │   │   ├── ToolProgress.tsx
│   │   │   ├── ApprovalModal.tsx
│   │   │   ├── InputPrompt.tsx
│   │   │   ├── NotificationBanner.tsx
│   │   │   └── BorderBox.tsx
│   │   └── utils/
│   │       └── markdownToInk.ts
│   └── config/
│       └── loader.ts      ← YAML 配置加载
└── tests/
    └── *.test.ts          ← 基础测试
```

---

## 开发原则

1. **Agent 核心先行** — Phase 1 专注于 Agent 调通，TUI/画布是后话
2. **Provider 可插拔** — LLM Provider 通过接口抽象，随时可替换
3. **Tool 可扩展** — 新增 Tool 只需注册到 Registry，无需改动核心
4. **Approval 不可绕过** — 危险操作必须暂停，不存在 silent fallback
5. **最小上下文** — 只传递必要信息，控制 token 消耗
6. **自学习优先** — 任何重复操作都值得固化；Agent 自己发现，不是人教的

---

## 当前状态

| 模块 | 状态 |
|------|------|
| LLM Provider 抽象 | ⬜ 待实现 |
| Anthropic Provider | ⬜ 待实现 |
| OpenAI Provider | ⬜ 待实现 |
| Tool Registry | ⬜ 待实现 |
| Tool Executor（含并行 + Zod） | ⬜ 待实现 |
| Bash Tool | ⬜ 待实现 |
| Read Tool | ⬜ 待实现 |
| Edit Tool | ⬜ 待实现 |
| Grep Tool | ⬜ 待实现 |
| Glob Tool | ⬜ 待实现 |
| 文件沙箱化（路径校验） | ⬜ 待实现 |
| Session Manager | ⬜ 待实现 |
| 上下文构建管道（context.ts） | ⬜ 待实现 |
| Session 持久化（JSONL） | ⬜ 待实现 |
| 自动压缩（Summarizer） | ⬜ 待实现 |
| Session 隔离 + 恢复 | ⬜ 待实现 |
| Approval Hook（异步） | ⬜ 待实现 |
| REPL 双状态机 | ⬜ 待实现 |
| 反思机制（技能生成） | ⬜ 待实现 |
| Skill Registry | ⬜ 待实现 |
| Skill Patcher（自动校准） | ⬜ 待实现 |
| 跨会话记忆（JSON 文件 + 内存缓存） | ⬜ 待实现 |
| 斜杠命令系统 | ⬜ 待实现 |
| 并行 Tool 执行 | ⬜ 待实现 |
| 基础测试 | ⬜ 待实现 |

---

## 相关文档

- `design.md` — Agent 层详细设计（LLM 抽象、Tool 规范、Approval 流程等）
- `dream.md` — 原始愿景（含 Terminal Panel、Agent 协 作设计）
- `design.md`（根目录）— 完整设计文档
