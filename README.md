# @chromatopsia/agent

Chromatopsia——拥有**自学习能力**的coding agent，叫做Chromatopsia是因为作者喜欢王菲的《色盲》。

目前Chromatopsia一期开发和二期开发的交界处，持续开发(以及修bug)中，Readme更新不及时。

## 核心功能

### 1. LLM 基础层 (Foundation LLM)

- **多模型支持**：内置对 Anthropic (Claude) 和 OpenAI 模型系列的支持。
- **Provider 抽象**：提供统一的接口来处理不同 LLM 的消息格式和调用逻辑。

### 2. 工具系统 (Tool System)

内置了丰富的开发者工具，使 Agent 能够感知并操作本地环境：

- **文件操作**：`read` (读取文件), `edit` (结构化编辑文件), `glob` (模式匹配查找文件)。
- **代码搜索**：`grep` (正则搜索代码内容)。
- **系统命令**：`bash` (执行终端命令)。
- **网络能力**：`websearch` (搜索引擎检索), `webfetch` (网页内容抓取并转为 Markdown)。

### 3. 会话管理 (Session Management)

- **上下文压缩**：通过 `Summarizer` 自动对历史长对话进行摘要，确保持续对话的效率。
- **历史记录**：管理完整的对话历史和 Token 使用情况。
- **上下文注入**：根据当前任务自动选择相关的上下文信息。

### 4. 记忆系统 (Memory System)

- **跨会话记忆**：通过持久化存储实现知识的积累，Agent 可以记住之前的决策和项目背景。
- **智能检索**：根据当前对话内容自动关联历史记忆，增强任务处理的连贯性。

### 5. 技能系统 (Skills System)

- **技能是什么**：Skill 是一段可执行的“操作配方”，核心是按顺序执行的一组工具调用步骤（`skill.steps`），并可附带注意事项与验证方式。
- **触发与执行**：根据 `trigger_pattern`（正则）与 `trigger_condition`（关键词）对用户输入做预匹配，命中后可在正常对话回合前直接执行该技能的工具步骤。
- **技能来源**：支持内置技能与用户自定义技能；Learning 生成的草稿技能默认不启用，需要审核后才能进入可用技能库。

### 6. Learning 系统 (Learning)

- **事件记录**：按 session 记录 turn 级事件（task_type、用户输入等），用于识别“重复出现但未命中技能”的模式。
- **草稿生成**：满足条件后触发离线学习，让 LLM 归纳近期操作序列并生成 draft skill（保存为草稿，默认不可触发）。
- **人工审核**：通过 `/skill review | approve <id> | reject <id>` 管理草稿技能，避免自动学习污染主流程。

### 7. 安全与钩子 (Hooks & Safety)

- **操作审批**：内置 `approval` 钩子，关键操作（如执行 `bash` 命令）可配置为需要人工确认，确保执行安全。

## 二期开发目标
- [ ] 接入TUI
- [ ] 多Agent协同，配置不同Agent的权限和任务分配以及Api
