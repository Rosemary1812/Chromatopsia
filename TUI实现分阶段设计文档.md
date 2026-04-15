# Chromatopsia TUI 实现分阶段设计文档

> 目标：在现有 `agent core + CLI/TUI 输出层拆分` 的基础上，明确 TUI 的落地路径。
> 当前决策：第一版只做内建命令，不做 Skill 映射。

---

## 阶段一 Todo

- 抽离不依赖 `readline` 的 turn 执行入口
- 定义 `RuntimeEvent` 类型
- 定义 `RuntimeSink` 或等价 runtime 适配接口
- 将流式输出改为通过 runtime 事件发出
- 将工具开始/结束/批次结束改为通过 runtime 事件发出
- 将审批请求接入 runtime 事件链路
- 将回合完成事件接入 runtime 事件链路
- 让 CLI 改为消费新的 runtime 层
- 保持现有审批流程可用
- 为 runtime 事件预留 `agentId`
- 为 runtime 事件预留 `agentRole`
- 为第一阶段补充对应测试

## 阶段二 Todo

- 建立 TUI 状态 store
- 定义 transcript item view model
- 建立 runtime 事件到 store 的映射逻辑
- 建立普通输入态
- 建立审批输入态
- 建立输入态切换逻辑
- 建立内建命令注册表
- 实现 `/help`
- 实现 `/clear`
- 实现 `/exit`
- 建立工具结果摘要逻辑
- 建立通知与错误显示状态
- 建立当前回合 streaming 状态
- 建立当前工具执行状态
- 为第二阶段补充对应测试

## 阶段三 Todo

- 搭建 Ink `App` 根组件
- 实现 `Header`
- 实现 `Transcript`
- 实现 `TranscriptItem`
- 实现 `InputBox`
- 实现 `ApprovalPrompt`
- 实现 `Footer`
- 实现 `CommandHelp`
- 接入 store 到 Ink 组件树
- 接入普通输入提交流程
- 接入审批交互流程
- 接入内建命令显示与执行
- 接入流式输出渲染
- 接入 Markdown 渲染
- 接入代码块语法高亮
- 接入工具状态摘要渲染
- 接入通知与错误渲染
- 接入 Ctrl+C 中断处理
- 跑通单 Agent 最小 TUI 闭环
- 为第三阶段补充对应测试

---

## 0. 设计目标

这次 TUI 不是单纯“换一个终端界面”，而是要把当前基于 `readline + AgentEvents` 的交互方式，整理成一个可以长期扩展的终端 UI 系统。

第一版 TUI 的目标是：

- 支持正常多轮对话
- 支持流式输出
- 支持工具执行状态展示
- 支持高危操作审批
- 支持少量内建命令
- 支持中断当前回合
- 为后续多 Agent 协同保留扩展点，但不在第一版实现多 Agent 面板

第一版 TUI **不包含**：

- Skill slash 映射
- Todo 面板
- Diff 多面板
- Session 列表/切换 UI
- 多 Agent 协同可视化

---

## 1. 阶段一：先实现通信层

这一阶段的目标不是“做界面”，而是先把 TUI 与 Agent Core 之间的连接方式稳定下来。

### 1.1 为什么要先做通信层

当前 `agent` 对外暴露的是 `AgentEvents` 回调：

- `onStreamChunk`
- `onApprovalRequest`
- `onTurnComplete`
- `onToolStart`
- `onToolEnd`
- `onToolBatchEnd`
- `onNotification`
- `onError`
- `onDebug`

这套接口足够支持 CLI，但不够支撑完整 TUI。原因是：

- 回调是离散的，TUI 要自己拼装状态
- transcript 没有统一结构
- 审批、工具状态、assistant 流式输出分散在不同事件里
- 当前 `run_repl()` 同时管理输入、回合、输出，不利于 TUI 接管

所以第一阶段要做的是：把“可显示的运行时信息”整理成稳定协议。

### 1.2 第一阶段目标

建立一个 **TUI 可消费的运行时事件层**，让 TUI 不直接依赖零散回调。

建议新增一层：

- `AgentRuntime`
- 或 `TurnRunner`
- 或 `RuntimeAdapter`

职责：

- 驱动一次用户输入回合
- 统一产出运行时事件
- 隔离 `readline`
- 隔离 CLI/TUI 的具体渲染方式

### 1.3 建议的运行时事件协议

第一版不强行改持久化消息格式，只新增运行时事件协议：

```ts
type RuntimeEvent =
  | { type: 'turn_started'; turnId: string; text: string }
  | { type: 'assistant_chunk'; turnId: string; chunk: string }
  | { type: 'assistant_message'; turnId: string; content: string; toolCalls?: ToolCall[] }
  | { type: 'tool_started'; turnId: string; toolCall: ToolCall }
  | { type: 'tool_finished'; turnId: string; toolCall: ToolCall; result: ToolResult }
  | { type: 'tool_batch_finished'; turnId: string; toolCalls: ToolCall[]; results: ToolResult[] }
  | { type: 'approval_requested'; turnId: string; request: ApprovalRequest }
  | { type: 'approval_resolved'; turnId: string; requestId: string; decision: ApprovalDecision }
  | { type: 'notification'; message: string }
  | { type: 'error'; message: string }
  | { type: 'turn_completed'; turnId: string; content: string };
```

这层协议是给 TUI 用的，不要求立即替换 session 持久化里的 `Message` 结构。

### 1.4 第一阶段要改哪些地方

#### A. 从 `run_repl()` 中抽出“单回合执行器”

当前 `run_repl()` 混合了：

- 输入读取
- 用户 turn 调度
- LLM streaming
- tool loop
- 输出回调

需要拆出一个更底层的执行单元，比如：

```ts
run_turn(input: string, runtime: RuntimeSink): Promise<void>
```

或：

```ts
run_turn_stream(input: string): AsyncGenerator<RuntimeEvent>
```

这样：

- CLI 继续用它
- TUI 也用它
- 后续测试也更容易写

#### B. 定义 RuntimeSink / RuntimeAdapter

如果不想一口气改成 `AsyncGenerator`，可以先做一个中间适配器：

```ts
interface RuntimeSink {
  emit(event: RuntimeEvent): void;
  requestApproval(request: ApprovalRequest): Promise<ApprovalResponse>;
}
```

这样能减少对现有 `repl/loop.ts` 的重写幅度。

#### C. 审批链路标准化

当前审批机制已经存在，但要保证：

- TUI 能收到 `approval_requested`
- TUI 响应后能继续执行当前 turn
- 当前 turn 在审批时应进入阻塞态

这里不需要重写 `ApprovalHook`，只需要让 runtime 层把审批状态显式暴露出来。

### 1.5 第一阶段交付物

完成这一阶段后，仓库里应该有：

- 一个不依赖 `readline` 的 turn 执行入口
- 一份稳定的 `RuntimeEvent` 类型定义
- CLI 基于这套 runtime 继续工作
- TUI 可以开始基于同一 runtime 构建状态

### 1.6 第一阶段验收标准

- 不启动 TUI 也能驱动一轮对话
- 一轮对话中的流式 chunk、工具开始/结束、审批、完成事件都可被捕获
- CLI 不因这次改造而失效
- 审批链路仍然可用

---

## 2. 阶段二：在通信层和最终 TUI 之间，需要补的内容

这阶段是“把原始事件变成 UI 可用状态”。

如果第一阶段解决的是“怎么传”，第二阶段解决的是“拿到之后怎么组织”。

### 2.1 这一阶段的目标

建立 TUI 自己的状态管理层，让 UI 组件只关心显示，不关心 agent 运行细节。

建议新增：

- `AgentLoopStore`
- 或 `TuiStore`
- 或 `TranscriptStore`

### 2.2 需要管理的状态

第一版 TUI 至少需要这些状态：

- `messages`
- `streaming`
- `currentTurnId`
- `approvalRequest`
- `toolActivity`
- `notifications`
- `lastError`
- `inputMode`
- `commandPaletteState`

建议的内部 view model：

```ts
type TranscriptItem =
  | { kind: 'user'; text: string; timestamp: number }
  | { kind: 'assistant'; text: string; streaming?: boolean; timestamp: number }
  | { kind: 'tool'; name: string; status: 'running' | 'success' | 'error'; summary?: string; timestamp: number }
  | { kind: 'notification'; text: string; level: 'info' | 'error' };
```

注意：这一层是 **TUI 内部显示模型**，不要求与 session 持久化结构一致。

### 2.3 输入命令体系

第一版只做内建命令。

建议支持：

- `/help`
- `/clear`
- `/exit`

建议暂不支持：

- `/review`
- `/debug`
- `/skill review`
- `/session`

#### 命令处理原则

- `/help`：本地处理，不发给 agent
- `/clear`：本地处理，清空当前 transcript 与上下文
- `/exit`：本地处理，退出 TUI

这一步要补一个命令注册表，例如：

```ts
interface BuiltinCommand {
  name: string;
  description: string;
  run(context: TuiCommandContext): Promise<void> | void;
}
```

### 2.4 输入与审批模式切换

TUI 至少要有两种输入状态：

- 普通输入态
- 审批态

审批态下：

- 输入框不再提交普通消息
- 用户只能选择 `y/n`
- 当前 turn 保持阻塞

这部分如果不先设计清楚，UI 会很容易在审批时和普通输入打架。

### 2.5 输出摘要策略

工具输出不应原样全量刷到主界面。

建议第一版策略：

- assistant 文本：完整展示
- tool start/end：展示摘要
- tool result：优先显示短摘要
- 错误：高亮展示
- 通知：单行展示

这一步需要定义一个 summarizer：

```ts
summarizeToolResult(toolCall, result) => string | null
```

### 2.6 第二阶段交付物

完成这一阶段后，仓库里应该有：

- TUI 内部状态 store
- 运行时事件到 UI 状态的映射逻辑
- 内建命令注册表
- 审批态/普通输入态切换
- transcript item 的显示模型

### 2.7 第二阶段验收标准

- TUI 不再直接读写底层 `AgentEvents`
- slash 输入能够识别内建命令
- 审批时输入行为正确切换
- transcript 可稳定展示 user / assistant / tool / error

---

## 3. 阶段三：把 TUI 做出来

这是最终界面层。

建议技术栈维持之前调研方向：

- Ink
- React
- 必要时配合 markdown 终端渲染库

### 3.1 第一版 TUI 界面范围

第一版建议只做单栏主界面，不做复杂多面板。

建议结构：

```text
┌──────────────────────────────────────────────┐
│ Header                                       │
├──────────────────────────────────────────────┤
│ Transcript                                   │
│ - user message                               │
│ - assistant streaming / final                │
│ - tool status summary                        │
│ - notification / error                       │
├──────────────────────────────────────────────┤
│ ApprovalPrompt 或 InputBox                   │
├──────────────────────────────────────────────┤
│ Footer / StatusBar                           │
└──────────────────────────────────────────────┘
```

### 3.2 第一版组件建议

建议至少拆成这些组件：

- `App`
- `Header`
- `Transcript`
- `TranscriptItem`
- `InputBox`
- `ApprovalPrompt`
- `Footer`
- `CommandHelp`

#### 组件职责

- `App`：挂载 store，统一组合页面
- `Header`：显示应用名、模型、工作目录
- `Transcript`：显示消息历史和工具摘要
- `InputBox`：普通输入
- `ApprovalPrompt`：审批输入
- `Footer`：显示状态，如 streaming / idle
- `CommandHelp`：展示 `/help` 内容

### 3.3 第一版交互要求

- Enter 提交消息
- 流式输出时能持续刷新 assistant 内容
- 高危操作时弹出审批框
- `/help` 展示内建命令
- `/clear` 能清屏并清上下文
- `/exit` 退出程序
- Ctrl+C 中断当前 turn 或退出程序

### 3.4 暂不做的 UI 能力

这些能力不建议在第一版进入范围：

- 多 Agent 状态面板
- Diff 面板
- Todo 面板
- 命令补全下拉
- session 管理器
- 主题系统
- token 统计面板

原因不是这些不重要，而是当前基础层还没稳定，第一版先保证单 Agent TUI 可靠可用。

### 3.5 第三阶段交付物

完成这一阶段后，仓库里应该有：

- 一个真正可运行的 Ink TUI
- 基础对话、流式输出、工具摘要、审批、内建命令
- 与 CLI 并行存在的独立输出层

### 3.6 第三阶段验收标准

- 可用 TUI 完成一轮普通对话
- 可在 TUI 中触发工具调用并看到执行状态
- 可在 TUI 中处理审批
- 可通过 `/help`、`/clear`、`/exit` 完成内建命令交互
- CLI 与 TUI 共用同一套 agent runtime

---

## 4. 关于多 Agent 协同：现在需不需要适配到 TUI

结论：**需要预留，但不需要第一版就实现。**

### 4.1 为什么现在不建议直接做

当前项目的核心问题还不是“多 Agent 怎么展示”，而是：

- 单 Agent runtime 还没有彻底从 `readline` 中抽离
- TUI 还没有稳定状态层
- transcript 结构还不完整

如果现在直接做多 Agent TUI，风险很大：

- 先把复杂度推到 UI
- 底层协议不稳，面板设计会反复推翻
- 单 Agent 能力还没打磨好，就会过早引入并发状态同步问题

### 4.2 为什么又要预留

因为你后续确实可能接入多 Agent 协同，所以通信层设计时要避免把自己锁死在“只支持一个 agent”的假设里。

建议在 runtime event 里预留：

- `agentId`
- `agentRole`
- `parentTurnId` 或 `parentAgentId`

例如：

```ts
type RuntimeEventBase = {
  agentId: string;
  agentRole?: 'main' | 'worker' | 'reviewer';
};
```

第一版单 Agent 时：

- 固定 `agentId = "main"`

以后扩展多 Agent 时：

- 每个 worker 有自己的事件流
- TUI 再决定是单独面板展示，还是聚合到主 transcript

### 4.3 当前应该做的多 Agent 准备

现在只建议做这三件事：

- 事件协议里预留 `agentId`
- store 内部不要把状态写死成单实例不可扩展
- UI 组件命名避免强耦合，如用 `TranscriptPane` 而不是 `MainAssistantOnlyPane`

### 4.4 当前不建议做的多 Agent 工作

- 不做 worker 面板
- 不做并行进度布局
- 不做多 agent tab
- 不做 agent tree 视图
- 不做 worktree/diff 联动 UI

---

## 5. 推荐实施顺序

建议严格按下面顺序推进：

1. 抽离 runtime，完成通信层改造
2. 建立 TUI store 和 transcript view model
3. 接入内建命令和审批模式切换
4. 实现第一版 Ink TUI
5. 跑通单 Agent 稳定交互
6. 再评估是否进入 session UI、命令补全、多 Agent 面板

---

## 6. 第一版范围总结

第一版 TUI 要做的事情：

- 通信层抽象
- TUI 状态层
- 内建命令
- 审批 UI
- 基础对话与流式渲染

第一版 TUI 不做的事情：

- Skill slash 映射
- 多 Agent 可视化
- 复杂多面板
- 高级状态面板

这个范围是保守但正确的。先把单 Agent TUI 做扎实，再扩展多 Agent，成本最低。
