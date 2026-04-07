# DevCanvas — 多项目并行 Agent 开发画布

## 1. Concept & Vision

**DevCanvas** 是一款面向开发者的下一代 Agent 编程工具，核心理念是**将 AI 协作带入真实的多项目并行开发体验**。

不同于传统 AI  Coding 助手的单线程对话模式，DevCanvas 以无限画布为核心，支持开发者同时管理多个项目、多个终端、多个 Agent 任务，所有进度一目了然，子 Agent 的工作状态清晰可见，人类决策点精准触达。

设计关键词：**沉浸式画布**、**多线程协作**、**进程可见性**、**零干扰决策流**

---

## 2. Design Language

### 2.1 Aesthetic Direction
**Dark IDE + Blueprint Grid** — 灵感来自 Figma 的画布 + VS Code 的暗色 IDE 风格 + 建筑蓝图的精密感。专业、沉浸、高效，像一个数字工作台。

### 2.2 Color Palette
```
Background Canvas:    #0D1117  (深空黑)
Background Surface:   #161B22  (卡片/面板背景)
Background Elevated:  #21262D  (悬浮元素/终端)
Border Subtle:        #30363D  (分割线/边框)
Border Active:        #58A6FF  (选中/激活态)

Text Primary:         #E6EDF3  (主文字)
Text Secondary:       #8B949E  (次要文字/注释)
Text Muted:           #6E7681  (禁用态)

Accent Blue:          #58A6FF  (主操作/链接)
Accent Green:         #3FB950  (成功/运行中)
Accent Orange:        #D29922  (警告/等待决策)
Accent Red:           #F85149  (错误/终止)
Accent Purple:        #A371F7  (Agent 标识/特殊状态)

Agent Palette:        [#58A6FF, #A371F7, #3FB950, #D29922, #F85149]
                      (每个 Agent 分配一个唯一色标)
```

### 2.3 Typography
```
Font Code:    JetBrains Mono (终端/代码)
Font UI:      Inter (界面文字)
Font Display: Inter Bold (标题/项目名)

Scale:
  - 11px  (终端输出/最小注释)
  - 13px  (正文/终端输入)
  - 14px  (UI 标签)
  - 16px  (面板标题)
  - 20px  (项目名称)
  - 28px  (画布标题/空间站名)
```

### 2.4 Spacing System
```
Base unit: 4px
Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64
Panel padding: 16px
Card gap: 12px
Canvas grid: 20px (snap to grid)
```

### 2.5 Motion Philosophy
- **Panel transitions**: 200ms ease-out (展开/收缩)
- **Agent 状态脉冲**: 缓慢呼吸动画 2s infinite (running agent)
- **进度条**: 平滑连续动画，无跳跃
- **悬浮窗滑入**: 300ms cubic-bezier(0.16, 1, 0.3, 1)
- **决策弹窗**: 居中放大 250ms + 背景模糊渐入
- **最小化/恢复**: 画布视角平滑缩放过渡

### 2.6 Visual Assets
- **图标**: Lucide Icons (线性风格，2px stroke)
- **Agent 头像**: 几何图形 + 渐变色 (非 emoji)
- **终端光标**: 闪烁方块 #58A6FF
- **网格背景**: 微弱的点阵网格 (opacity 0.05)
- **进度指示**: 细线条 + 动态光点

---

## 3. Layout & Structure

### 3.1 主视图 — 无限画布 (Canvas)

```
┌─────────────────────────────────────────────────────────────────┐
│ [Toolbar]                                                       │
│  DevCanvas Logo  │ Project: [Dropdown] │ [+ New Project] │ ⚙  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│    ┌──────────────┐         ┌──────────────┐                    │
│    │  Project A   │         │  Project B   │                    │
│    │ ┌──────────┐ │         │ ┌──────────┐ │                    │
│    │ │Terminal 1│ │         │ │Terminal 1│ │     ┌──────────┐  │
│    │ │ (Agent 1)│ │         │ │ (Agent 3)│ │     │Project C │  │
│    │ └──────────┘ │         │ └──────────┘ │     │          │  │
│    │ ┌──────────┐ │         │ ┌──────────┐ │     └──────────┘  │
│    │ │Terminal 2│ │         │ │Terminal 2│ │                    │
│    │ │ (Agent 2)│ │         │ │ (Agent 4)│ │                    │
│    │ └──────────┘ │         │ └──────────┘ │                    │
│    └──────────────┘         └──────────────┘                    │
│                                                                 │
│                      [Infinite Canvas — 可拖拽、缩放]            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ [Status Bar]  ● 3 Agents Running  │  2 Projects  │  ⌘+K       │
└─────────────────────────────────────────────────────────────────┘
```

**画布特性：**
- 无限延展，支持拖拽平移和滚轮缩放
- 项目卡片以自由形式散布，可拖拽重排
- 项目之间可以建立依赖连线（虚线箭头）
- 双击空白处新建项目卡片
- 右键菜单：新建 Terminal、复制、归档、删除

### 3.2 项目卡片 (Project Card)

```
┌─────────────────────────────────────────┐
│ ● Project Name                    [─][□][×]│  ← 项目状态指示灯
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ $ Terminal — Agent: planner    │   │  ← 每个 Terminal 是独立
│  │ > Planning tasks...            │   │    运行空间
│  │   ✓ Subtask 1 complete         │   │
│  │   ⟳ Subtask 2 in progress      │   │
│  │   ○ Subtask 3 pending          │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ $ Terminal — Agent: coder      │   │
│  │ > Implementing feature X...    │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [+ New Terminal]                       │
├─────────────────────────────────────────┤
│ Progress: ████████░░ 80%  │  4 tasks    │  ← 聚合进度条
└─────────────────────────────────────────┘
```

**项目卡片特性：**
- 可折叠/展开（保持运行时状态）
- 标题可编辑
- 右上角控制：最小化、最大化（画布内）、关闭
- 底部显示整体进度和活跃 Agent 数量

### 3.3 终端面板 (Terminal Panel)

```
┌─────────────────────────────────────────┐
│ ◉ terminal-1    [Agent: planner]    [⋮]│  ← 圆点=状态灯，菜单
├─────────────────────────────────────────┤
│                                         │
│ [09:32:01] 🤖 Agent initialized         │
│ [09:32:02] 📋 Task: Implement login API │
│ [09:32:03] 🔍 Analyzing codebase...     │
│ [09:32:05] ✓ Found 3 relevant files    │
│ [09:32:06] ✏️  Editing auth/service.ts  │
│ [09:32:08] ⏳ Waiting for human confirm  │  ← 等待决策点
│                                         │
│ ─────────────────────────────────────── │
│ [09:32:10] 👤 Decision Required         │
│                                         │
│  The agent wants to modify:             │
│  `auth/service.ts`                      │
│                                         │
│  Proposed change:                       │
│  + function verifyToken(token) {...}    │
│                                         │
│  [✓ Approve] [✗ Reject] [Edit & Approve]│
│                                         │
└─────────────────────────────────────────┘
```

**终端面板特性：**
- 终端输出带时间戳和类型图标（info/success/warning/error/decision）
- 决策点特殊高亮显示（橙色边框 + 居中操作按钮）
- 支持滚动历史和搜索 (⌘+F)
- 右上角菜单：清空、重放、导出日志、拆分视图

### 3.4 悬浮小窗 (Mini Widget)

**最小化时展示在屏幕右下角：**

```
┌──────────────────────────┐
│ ● DevCanvas    [−][□][×] │  ← 拖拽移动
├──────────────────────────┤
│                          │
│  Project A  ●●●●░░  80%  │  ← 滚动显示所有项目进度
│  Project B  ●●░░░░  40%  │     进度条 + 百分比
│  Project C  ●●●●●● 100%  │     ● = Agent 活跃数
│                          │
│  ┌────────────────────┐  │
│  │ ⚠ Decision pending │  │  ← 决策等待时自动弹出
│  │ Project A → auth    │  │
│  │ [Take Action]      │  │
│  └────────────────────┘  │
│                          │
└──────────────────────────┘
```

**悬浮窗特性：**
- 可拖拽到屏幕任意角落
- 点击项目名快速定位到画布对应位置
- 决策卡片自动置顶，点击直接展开决策详情
- 展开后恢复到画布视图

### 3.5 决策弹窗 (Decision Modal)

**当 Agent 需要人类决策时，中央弹出：**

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│              ⚠️  Human Decision Required                │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Project: Project A                               │   │
│  │ Agent: planner                                    │   │
│  │ Terminal: terminal-1                              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  The agent wants to:                                     │
│  Modify `src/auth/service.ts`                           │
│                                                         │
│  Change summary:                                        │
│  + New function: verifyToken(token): Promise<boolean>  │
│  + Added dependency: jsonwebtoken                       │
│                                                         │
│  [ Impact Preview ]                                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Current:                           │  Proposed: │   │
│  │  ───────────                        │  ────────── │   │
│  │  function auth() { }                │  function   │   │
│  │                                    │  auth() { } │   │
│  │                                    │             │   │
│  │                                    │  + verify.. │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [ ✓ Approve ]  [ ✗ Reject ]  [ Edit & Approve ]         │
│                                                         │
│  Or edit directly:                                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │ // Your modifications here...                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**决策弹窗特性：**
- 背景画布自动模糊 + 暗化
- 显示影响范围预览（diff 风格）
- 可直接在弹窗内编辑后批准
- 支持键盘快捷键：⌘+Enter 批准，Esc 拒绝
- 决策历史可追溯

---

## 4. Features & Interactions

### 4.1 画布操作

| 操作 | 行为 |
|------|------|
| 滚轮拖拽 | 平移画布 |
| Ctrl + 滚轮 | 缩放画布 (0.25x - 2x) |
| 双击空白 | 新建 Project Card |
| 双击 Project 标题 | 编辑项目名 |
| 拖拽 Project 卡片 | 自由摆放 |
| 右键空白 | 上下文菜单（新建、粘贴、视图操作） |
| 右键 Project | 上下文菜单（复制、归档、删除、设置） |

### 4.2 项目管理

| 操作 | 行为 |
|------|------|
| 点击 [+ New Project] | 创建新项目卡片，自动分配颜色和名称 |
| 点击项目状态灯 | 展开/收起所有 Terminal |
| 拖拽 Terminal tab | 重排顺序 |
| 项目右上角 [×] | 关闭项目（确认对话框，如在运行中） |
| 项目内 [+ New Terminal] | 为该项目新建 Terminal 空间 |

### 4.3 终端交互

| 操作 | 行为 |
|------|------|
| 输入框回车 | 发送消息给该 Terminal 的 Agent |
| ⌘+K (全局) | 打开全局命令面板 |
| ⌘+F (Terminal 内) | 搜索终端历史 |
| 点击决策按钮 | 展开决策详情弹窗 |
| Terminal 右键菜单 | 清空/导出/拆分 |
| Agent 状态脉冲 | 正在思考中，显示脉冲动画 |

### 4.4 多 Agent 协作可视化

每个 Terminal 严格属于一个 Agent，但多个 Terminal 可以属于同一个项目：

```
Project A
├── Terminal 1: Agent(planner)     — 任务规划
├── Terminal 2: Agent(coder)      — 代码实现
├── Terminal 3: Agent(reviewer)   — 代码审查
└── Terminal 4: Agent(tester)      — 测试生成
```

**Agent 之间的通信：**
- 通过共享项目状态（文件修改、任务进度）
- 父 Agent（planner）可以分配子任务给其他 Agent
- 子 Agent 的进度实时反映在父 Agent 的任务列表中

### 4.5 任务进度系统

**任务状态流转：**

```
[Pending] ──▶ [In Progress] ──▶ [Completed]
                  │
                  ▼
            [Waiting for Decision] ──▶ [Approved/Rejected]
                  │
                  ▼
              [Blocked] (rejected)
```

**进度聚合计算：**
- 项目进度 = 所有 Terminal 内任务的加权平均
- 阻塞任务高亮显示
- 等待决策任务显示橙色脉冲

### 4.6 通知与提醒

| 场景 | 行为 |
|------|------|
| 子 Agent 完成任务 | 父 Agent 收到通知，终端内显示 |
| 需要人类决策 | 悬浮窗弹出 + 弹窗 + 任务栏徽标 |
| 项目出错/失败 | 悬浮窗显示红色警示 |
| 长时间无活动 | 静默保持，仅状态更新 |

### 4.7 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| ⌘+N | 新建项目 |
| ⌘+W | 关闭当前 Terminal |
| ⌘+Tab | 切换 Terminal |
| ⌘+Shift+\\ | 新建 Terminal（当前项目） |
| ⌘+Enter | 批准当前决策 |
| Esc | 拒绝当前决策 / 关闭弹窗 |
| ⌘+K | 全局命令面板 |
| ⌘+F | 搜索（上下文相关） |
| ⌘+B | 切换侧边栏（项目列表） |
| ⌘+M | 最小化到悬浮窗 |

---

## 5. Component Inventory

### 5.1 Canvas Workspace
- **Default**: 空白画布 + 点阵网格背景
- **With Projects**: 多个 Project Card 散布，带阴影和边框
- **Zoomed Out**: 项目卡片简化显示为色块 + 名称
- **Loading**: 画布骨架屏

### 5.2 Project Card
- **Default**: 折叠态，显示名称 + 进度
- **Expanded**: 展开所有 Terminal
- **Hover**: 边框高亮 (#58A6FF)
- **Active (selected)**: 边框加粗 + 微弱发光
- **Running**: 左上角绿色脉冲点
- **Error**: 左上角红色警示点
- **Minimized**: 仅标题栏 + 进度条

### 5.3 Terminal Panel
- **Idle**: 等待输入状态，光标闪烁
- **Running**: Agent 输出中，滚动自动跟随
- **Waiting Decision**: 橙色左边框，决策区域高亮
- **Completed**: 显示完成标记，可折叠
- **Error**: 红色边框，错误信息置顶
- **Disconnected**: 灰色调，断开图标

### 5.4 Agent Avatar
- 几何图形组合 + 渐变色背景
- 每个 Agent 唯一配色（从 Agent Palette 分配）
- Running 状态：缓慢旋转动画
- Idle 状态：静态
- Thinking 状态：脉冲扩散动画

### 5.5 Mini Widget
- **Collapsed**: 仅状态条（项目计数 + 活跃数）
- **Expanded**: 滚动项目列表
- **Alert Active**: 顶部决策卡片自动展开
- **Dragging**: 轻微放大 + 阴影加深

### 5.6 Decision Modal
- **Default**: 居中白板，背景模糊
- **Hover Buttons**: 按钮颜色加深
- **Edit Mode**: 出现文本编辑区
- **Loading**: 按钮显示 spinner

### 5.7 Task List Item
- **Pending**: 灰色圆圈
- **In Progress**: 蓝色旋转圆圈
- **Completed**: 绿色勾选
- **Waiting Decision**: 橙色脉冲
- **Blocked**: 红色叉号

### 5.8 Toolbar
- **Default**: 透明背景，图标清晰
- **Scrolled**: 背景模糊 + 边框出现
- **With Dropdown Open**: 下拉菜单展开

### 5.9 Status Bar
- 固定底部，显示全局状态
- 实时更新 Agent 计数、项目计数

---

## 6. Technical Constraints & Assumptions

- **前端优先**：UI 必须先行，设计稿确认后再进入架构讨论
- **响应式**：最小支持 1280x720，目标 1440p+ 显示器
- **性能目标**：100+ Terminal 同时运行仍保持流畅
- **可访问性**：基础键盘导航支持，决策弹窗支持 Esc 关闭
- **国际化**：UI 文字暂定英文，中文作为后续考虑

---

## 7. Out of Scope (This Phase)

以下内容暂不在 design.md 范围内，后续单独文档处理：

- 后端架构设计
- 数据库 / 状态持久化方案
- 多 Agent 通信协议
- LLM Provider 集成
- 部署和分发
- 移动端 / 响应式适配
- 插件系统
