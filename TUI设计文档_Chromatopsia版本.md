# Chromatopsia TUI 设计文档

> 设计目标：在终端中提供接近 Claude Code 的使用体验，整体风格克制、清晰、稳定。
> 品牌约束：Icon 使用鱼，主色调使用粉紫色系。
> 当前范围：单 Agent TUI，覆盖普通对话、流式输出、工具状态、审批、内建命令。

---

## 1. 设计目标

Chromatopsia 的 TUI 目标不是做成复杂面板型终端，而是做成一个：

- 上手成本低
- 长时间使用不疲劳
- 信息密度高但不杂乱
- 对工具执行过程透明
- 审批动作明确
- 和 Agent 工作流强绑定

整体体验参考 Claude Code 的终端风格，但不照搬视觉细节。Chromatopsia 的 TUI 应该保留“安静、工具化、偏工程”的气质，同时通过鱼 icon 和粉紫色主视觉建立自己的识别度。

---

## 2. 产品定位

TUI 是 Chromatopsia 的主交互界面之一，定位介于：

- 纯命令行输出
- IDE 内嵌复杂工作台

之间。

它应该承担的职责是：

- 承接日常单 Agent 对话
- 展示 agent 的流式工作过程
- 展示工具执行状态
- 渲染 Markdown 输出
- 渲染代码块高亮
- 承接用户审批
- 承接少量内建命令

它当前不承担的职责是：

- 多 Agent 调度中心
- 项目仪表盘
- Git / diff 专业界面
- 复杂 session 管理器

---

## 3. 设计原则

### 3.1 像 Claude Code，但不是复制品

需要借鉴的点：

- 单栏主视图
- 强调最新交互
- 流式输出自然
- 不把工具输出原样刷屏
- 审批与输入区合并管理
- 控制视觉噪音

不直接复制的点：

- 品牌图形
- 色彩体系
- 文案风格
- 后续多 Agent 扩展结构

### 3.2 信息优先于装饰

终端 UI 的重点是：

- 用户当前输入了什么
- agent 当前在做什么
- 是否正在阻塞等待
- 有没有风险动作需要确认
- 这一轮是否完成

装饰只能用于辅助层级，不应喧宾夺主。

### 3.3 新信息优先，历史信息后退

TUI 主视图应该偏向显示最新消息、当前状态和当前输入。历史内容主要通过终端 scrollback 保留，不在屏幕里做沉重的全量消息列表。

### 3.4 颜色有识别度，但不能发光发亮

粉紫色是品牌主色，不意味着大面积高亮。

建议策略：

- 主品牌色只用在标题、强调、焦点和轻量边框
- 正文仍以中性灰白为主
- 错误、危险、审批等状态继续使用传统语义色

---

## 4. 视觉方向

### 4.1 品牌图形

主 icon 使用鱼。

建议特征：

- 简化像素/ASCII 风格
- 可在终端中稳定显示
- 轮廓清晰
- 不依赖复杂 Unicode 图案

建议优先采用两种方案：

#### 方案 A：单字符前缀

```text
◔
```

或自定义近似鱼形符号作为消息前缀。

#### 方案 B：Header 中使用简化 ASCII 鱼

```text
   /`·.¸
  /¸...¸`:·
 ¸.·´  ¸   `
 : © ):´;      ¸  {
  `·.¸ `·  ¸.·´\`·¸)
      `\\´´\¸.·´
```

第一版建议使用更保守的方案：Header 用小型 ASCII 鱼，消息前缀仍使用统一符号体系。

### 4.2 色彩体系

主色调：粉紫色。

建议采用以下语义配色：

- `brandPrimary`: `#d88cf6`
- `brandStrong`: `#c468ee`
- `brandSoft`: `#f3d7ff`
- `surfaceBorder`: `#5f5268`
- `textPrimary`: `#f6f3f8`
- `textMuted`: `#b9afc2`
- `textDim`: `#8e8498`
- `success`: `#7dd3a7`
- `warning`: `#f6c177`
- `danger`: `#ef8891`
- `info`: `#7ec8ff`

背景不建议做纯粉紫。建议使用深色中性背景，粉紫只作为强调色。

推荐背景层次：

- `bgBase`: 深灰紫黑
- `bgPanel`: 比 `bgBase` 稍亮一级
- `bgInput`: 再亮一级，但仍保持低对比

### 4.3 字符与符号风格

推荐符号体系：

- 用户输入前缀：`>`
- Assistant 前缀：`●`
- 流式处理中：`◌` / `◐`
- 工具执行成功：`✓`
- 工具执行失败：`✕`
- 审批等待：`!`
- 通知：`·`

如果后续想强化品牌感，可以把 Assistant 前缀替换成一个“鱼化”的专用符号，但第一版不建议过度花哨。

---

## 5. 总体布局

整体采用单栏布局。

```text
┌──────────────────────────────────────────────────────────┐
│ Header                                                   │
├──────────────────────────────────────────────────────────┤
│ Transcript                                               │
│                                                          │
│  > user input                                            │
│  ● assistant response                                    │
│  ✓ tool summary                                          │
│  ! approval waiting                                      │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ InputBox / ApprovalPrompt                                │
├──────────────────────────────────────────────────────────┤
│ Footer                                                   │
└──────────────────────────────────────────────────────────┘
```

布局原则：

- Header 高度固定
- Transcript 是主区域
- 输入区域固定在底部
- Footer 只保留一行状态

不做左右分栏，不做顶部多标签，不做复杂停靠区。

---

## 6. 关键界面区域

### 6.1 Header

Header 用于表达“这是 Chromatopsia，不是一个普通 shell”。

包含信息：

- 鱼 icon
- `Chromatopsia`
- 当前模型名
- 当前工作目录
- 当前模式，如 `idle` / `streaming` / `approval`

视觉要求：

- 高度较低
- 粉紫强调标题
- 其余信息弱化

建议示意：

```text
[fish] Chromatopsia    model: gpt-5.x    cwd: /repo/path
```

### 6.2 Transcript

Transcript 是 TUI 的核心区域。

它应该展示：

- 用户消息
- assistant 流式文本
- Markdown 结构化内容
- 代码块高亮内容
- 工具执行摘要
- 通知
- 错误

它不应该展示：

- 大段原始工具输出
- 冗余 JSON
- 审批历史全文

展示策略：

- 偏重当前回合和最近消息
- 老消息不做复杂装饰
- assistant 的输出应该是最容易扫读的内容

### 6.3 Markdown 与代码高亮

TUI 需要支持基础 Markdown 渲染，并对代码块做语法高亮。

第一版建议支持：

- 段落
- 行内代码
- 标题
- 无序列表
- 有序列表
- 引用
- fenced code block

代码高亮建议：

- 优先按 fenced code block 的语言标记渲染
- 无语言标记时使用纯代码样式，不做猜测性高亮
- 颜色要服从整体粉紫深色主题，不使用过亮配色
- 高亮重点是可读性，不追求 IDE 级着色复杂度

展示要求：

- 行内代码使用弱背景或品牌弱强调
- 代码块与正文有清晰区隔
- 代码块保留缩进
- 长代码块允许截断或依赖终端 scrollback，不应破坏主布局

建议技术方向：

- Markdown 转终端文本渲染
- 代码块单独走高亮渲染器
- Markdown 正文与代码块统一纳入 TranscriptItem 渲染链路

### 6.4 InputBox

普通状态下底部显示输入框。

行为要求：

- 支持单行输入
- Enter 提交
- 支持 `/help`、`/clear`、`/exit`
- 支持显示轻量 placeholder

建议 placeholder：

```text
Ask Chromatopsia to inspect, edit, debug, or explain...
```

### 6.5 ApprovalPrompt

当工具需要审批时，底部输入区切换为审批框。

应显示：

- 工具名
- 简要上下文
- 参数摘要
- 明确的 `Yes / No` 指引

建议形式：

```text
! Approval required: run_shell
  context: tool execution
  args: command=...
  Allow execution? [y/N]
```

审批框应比普通输入框更醒目，但仍保持克制。建议使用 warning 色边框或标题色。

### 6.6 Footer

Footer 只保留最必要信息。

建议显示：

- 当前状态：`idle` / `working` / `approval`
- 最近工具状态摘要
- 内建命令提示，如 `/help`

例如：

```text
working · /help for commands
```

---

## 7. 消息展示规则

### 7.1 用户消息

用户消息应简洁、明确，与 assistant 消息形成区分。

建议样式：

- 使用 `>` 前缀
- 文本亮度低于 assistant
- 不使用重边框

示意：

```text
> 帮我检查一下 session manager 的恢复逻辑
```

### 7.2 Assistant 消息

assistant 消息是最重要的信息层。

建议样式：

- 使用 `●` 前缀
- 正文高对比显示
- markdown 保持基本可读性
- 代码块保持结构和高亮
- 流式输出时允许内容逐步展开

示意：

```text
● 我先读取 `session/manager.ts` 和相关 history 实现，再判断恢复逻辑是否完整。
```

### 7.3 工具消息

工具消息应该是摘要，而不是日志。

建议样式：

- 只显示工具名称和摘要结果
- 成功用 `✓`
- 失败用 `✕`
- 不展示全量 stdout/stderr，除非结果失败且确实有必要

示意：

```text
✓ read: packages/agent/src/session/manager.ts
✓ grep: found 3 matches for recover_or_prompt
✕ bash: command failed
```

### 7.4 通知与错误

通知应轻量展示，错误应明确强调。

通知示意：

```text
· Draft skill generated: xxx
```

错误示意：

```text
✕ LLM Error: request timeout
```

---

## 8. 流式输出体验

流式输出是整个 TUI 体验的关键。

要求：

- assistant 的文本能自然逐步出现
- 输出过程中输入框仍然稳定
- 不因 chunk 过密导致画面闪烁
- tool call 发生时能让用户感知到状态切换

建议：

- 对 chunk 做轻量批量刷新
- 使用柔和的活动指示符
- 不使用夸张动画

可选的 streaming 指示：

```text
◌ Thinking...
◐ Working...
```

颜色建议使用粉紫弱强调，而不是高亮闪烁。

流式输出和 Markdown/代码高亮之间需要遵守两个原则：

- 流式阶段允许先以纯文本逐步显示
- 回合稳定后再以完整 Markdown 结果重新渲染当前 assistant 消息

---

## 9. 内建命令设计

第一版只设计三个内建命令：

- `/help`
- `/clear`
- `/exit`

### 9.1 `/help`

用途：

- 显示当前可用内建命令

展示建议：

```text
Commands
  /help   Show available commands
  /clear  Clear current conversation
  /exit   Exit Chromatopsia
```

### 9.2 `/clear`

用途：

- 清空当前 transcript
- 清空当前会话上下文

交互建议：

- 执行后显示一条轻量通知

### 9.3 `/exit`

用途：

- 退出 TUI

交互建议：

- 如果当前没有进行中的 turn，直接退出
- 如果当前正在工作，可后续再考虑二次确认，第一版可直接退出或优先中断

---

## 10. 键盘交互

第一版建议支持：

- `Enter`：提交输入
- `Ctrl+C`：中断当前 turn 或退出
- `y`：审批通过
- `n`：审批拒绝

第一版暂不要求：

- 命令补全下拉
- 历史浏览
- 光标多模式编辑
- 多快捷键体系

这些可以在后续增强版本中加入。

---

## 11. 状态模式

TUI 至少有三种主状态：

- `idle`
- `working`
- `approval`

### 11.1 idle

表现：

- Transcript 静态
- 底部显示普通输入框

### 11.2 working

表现：

- assistant 流式输出或工具执行中
- Footer 显示工作状态
- 如支持中断，则允许 Ctrl+C

### 11.3 approval

表现：

- 底部普通输入框被审批框替换
- 等待用户明确输入 `y/n`
- Transcript 中可以显示一条审批等待状态

---

## 12. 组件设计

建议的第一版组件结构：

- `App`
- `Header`
- `Transcript`
- `TranscriptItem`
- `InputBox`
- `ApprovalPrompt`
- `Footer`
- `CommandHelp`

### 12.1 App

职责：

- 连接 TUI store
- 根据当前模式切换输入区
- 组合全局布局

### 12.2 Header

职责：

- 展示品牌、模型、目录、状态

### 12.3 Transcript

职责：

- 展示最近消息与状态项

### 12.4 TranscriptItem

职责：

- 根据类型渲染 user / assistant / tool / notification / error

### 12.5 InputBox

职责：

- 管理普通输入
- 识别内建命令

### 12.6 ApprovalPrompt

职责：

- 渲染审批内容
- 响应 `y/n`

### 12.7 Footer

职责：

- 展示轻量全局状态

---

## 13. 第一版不做的内容

为控制范围，第一版不做：

- 多 Agent 面板
- 左右分栏
- todo panel
- diff panel
- 主题切换
- session 切换器
- 命令补全下拉
- token 仪表盘

第一版会做基础 Markdown 和代码高亮，但不做：

- 表格优化渲染
- Mermaid 渲染
- 复杂嵌套 Markdown 特殊样式
- 代码块复制按钮
- 折叠代码块

这些不应混入第一版设计目标。

---

## 14. 后续多 Agent 兼容思路

虽然第一版只做单 Agent，但设计上要避免把界面结构写死。

建议预留：

- transcript item 里带 `agentId`
- 后续可按 agent 分组
- Header / Footer 可显示当前主 agent 状态

但第一版界面仍然保持单栏，不显示 worker 面板。

---

## 15. 设计验收标准

一版设计落地后，TUI 应达到以下效果：

- 视觉风格接近 Claude Code 的终端体验
- 具备 Chromatopsia 自身品牌识别
- 鱼 icon 可稳定显示
- 粉紫色使用克制且有辨识度
- 普通对话自然
- 流式输出稳定
- 工具执行过程清晰但不刷屏
- 审批动作明确
- 内建命令易发现

---

## 16. 设计摘要

Chromatopsia 的 TUI 第一版应当是一个：

- 单栏
- 深色底
- 粉紫强调
- 鱼品牌
- 偏工程化
- 接近 Claude Code 体验

的终端工作界面。

它不追求华丽，而追求稳定、顺手、信息清晰，并为后续多 Agent 扩展保留余地。
