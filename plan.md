# Chromatopsia Agent 层实现计划

> 每个任务完成后，人工验证 → 确认通过 → agent commit → 下一个任务

---

## Phase 0：基础设施（1 个任务）

### [ ] T-00：types.ts + index.ts 全局类型与导出入口

**文件**：`packages/agent/src/types.ts`、`packages/agent/src/index.ts`

**内容**：
- Message、ToolCall、ToolResult、ToolDefinition、ToolHandler、ToolContext
- LLMResponse、ProviderConfig、StreamOptions、LLMProvider
- Session、ProjectContext、UserContext
- ApprovalRequest、ApprovalResponse、ApprovalDecision
- Skill、TaskBufferEntry、ReflectionState、SynthesisResult
- ReplContextValue、LLMContext
- CompressionMetadata、CompressionConfig
- AppConfig

**验证指南**：`packages/agent/verification/00-types.md`

---

## Phase 1：LLM Provider 层（3 个任务，可并行）

### [ ] T-01：config/loader.ts 配置加载

**文件**：`packages/agent/src/config/loader.ts`

**内容**：YAML 配置文件读取、环境变量替换（`${VAR}`）、AppConfig 类型填充

**验证指南**：`packages/agent/verification/01-config.md`

### [ ] T-02：llm/provider.ts LLM Provider 接口

**文件**：`packages/agent/src/llm/provider.ts`

**内容**：LLMProvider 接口定义、chat() 和 chat_stream() 方法签名、StreamOptions、chat_stream 返回类型

**验证指南**：`packages/agent/verification/02-llm-provider.md`

### [ ] T-03：llm/index.ts Provider 工厂函数

**文件**：`packages/agent/src/llm/index.ts`

**内容**：createProvider() 路由函数，根据 type 返回 Anthropic 或 OpenAI Provider

**验证指南**：`packages/agent/verification/03-llm-index.md`

---

## Phase 2：LLM Provider 实现（2 个任务，可并行）

### [ ] T-04：llm/anthropic.ts Anthropic Provider

**文件**：`packages/agent/src/llm/anthropic.ts`

**内容**：
- Anthropic SDK 集成（@anthropic-ai/sdk）
- chat() 非流式实现
- chat_stream() 流式实现（AsyncGenerator）
- 错误重试（指数退避）
- Anthropic tool_use 格式 → 内部 ToolCall 格式转换

**验证指南**：`packages/agent/verification/04-anthropic.md`

### [ ] T-05：llm/openai.ts OpenAI Provider

**文件**：`packages/agent/src/llm/openai.ts`

**内容**：
- OpenAI SDK 集成（openai）
- chat() 非流式实现
- chat_stream() 流式实现
- Function Calling 格式 → 内部 ToolCall 格式转换

**验证指南**：`packages/agent/verification/05-openai.md`

---

## Phase 3：Tool 系统（8 个任务，可并行）

### [ ] T-06：tools/registry.ts Tool 注册表

**文件**：`packages/agent/src/tools/registry.ts`

**内容**：ToolRegistry 类（register/get/get_all/get_dangerous）

**验证指南**：`packages/agent/verification/06-registry.md`

### [ ] T-07：tools/executor.ts Tool 执行器

**文件**：`packages/agent/src/tools/executor.ts`

**内容**：
- execute_tool() 单个执行 + Zod 参数校验
- 文件沙箱化（resolve_path、sandbox_bash_command）
- DENIED_PATTERNS 强制拒绝
- execute_tool_calls_parallel() 并行/串行逻辑

**验证指南**：`packages/agent/verification/07-executor.md`

### [ ] T-08：tools/bash.ts Bash Tool

**文件**：`packages/agent/src/tools/bash.ts`

**内容**：run_shell Tool（dangerous）、危险命令识别、沙箱处理

**验证指南**：`packages/agent/verification/08-bash.md`

### [ ] T-09：tools/read.ts Read Tool

**文件**：`packages/agent/src/tools/read.ts`

**内容**：Read Tool（safe）、offset/limit、文件不存在处理

**验证指南**：`packages/agent/verification/09-read.md`

### [ ] T-10：tools/edit.ts Edit Tool

**文件**：`packages/agent/src/tools/edit.ts`

**内容**：Edit Tool（warning）、old_string/new_string、文件不存在处理

**验证指南**：`packages/agent/verification/10-edit.md`

### [ ] T-11：tools/grep.ts + tools/glob.ts Grep & Glob Tools

**文件**：`packages/agent/src/tools/grep.ts`、`packages/agent/src/tools/glob.ts`

**内容**：Grep Tool（regex 搜索）、Glob Tool（glob pattern）

**验证指南**：`packages/agent/verification/11-grep-glob.md`

### [ ] T-12：tools/websearch.ts WebSearch Tool

**文件**：`packages/agent/src/tools/websearch.ts`

**内容**：WebSearch Tool（safe）、DuckDuckGo 集成、返回格式

**验证指南**：`packages/agent/verification/12-websearch.md`

### [ ] T-13：tools/webfetch.ts WebFetch Tool

**文件**：`packages/agent/src/tools/webfetch.ts`

**内容**：WebFetch Tool（safe）、Turndown HTML→Markdown、标题/语言提取

**验证指南**：`packages/agent/verification/13-webfetch.md`

---

## Phase 4：Session 层（4 个任务，可并行）

### [ ] T-14：session/history.ts Session 持久化

**文件**：`packages/agent/src/session/history.ts`

**内容**：SessionHistory 类、sessions/index.json 索引、session-id.jsonl 消息存储、append/archive/list/load 方法

**验证指南**：`packages/agent/verification/14-session-history.md`

### [ ] T-15：session/context.ts 上下文构建管道

**文件**：`packages/agent/src/session/context.ts`

**内容**：build_llm_context()、system prompt 构建、skill 注入、format_recent_messages()

**验证指南**：`packages/agent/verification/15-session-context.md`

### [ ] T-16：session/summarizer.ts 自动压缩

**文件**：`packages/agent/src/session/summarizer.ts`

**内容**：CompressionConfig、compress_session()、LLM 摘要生成、truncate 兜底、CompressionMetadata

**验证指南**：`packages/agent/verification/16-session-summarizer.md`

### [ ] T-17：session/manager.ts Session 管理器

**文件**：`packages/agent/src/session/manager.ts`

**内容**：SessionManager 类、create_session()、get_session()、add_message()、compact()、recover_or_prompt()

**验证指南**：`packages/agent/verification/17-session-manager.md`

---

## Phase 5：Memory + Skills（3 个任务，可并行）

### [ ] T-18：memory/storage.ts 记忆持久化

**文件**：`packages/agent/src/memory/storage.ts`

**内容**：SkillStore 类、~/.chromatopsia/skills.json 读写、load/save/delete/getAll/byTaskType/fuzzySearch

**验证指南**：`packages/agent/verification/18-memory-storage.md`

### [ ] T-19：skills/registry.ts + skills/patcher.ts 技能系统

**文件**：`packages/agent/src/skills/registry.ts`、`packages/agent/src/skills/patcher.ts`

**内容**：SkillRegistry 类、match/fuzzy_match/list/show/delete；SkillPatcher 类、patch/failure 分析

**验证指南**：`packages/agent/verification/19-skills.md`

---

## Phase 6：Hooks（1 个任务）

### [ ] T-20：hooks/approval.ts Approval 机制

**文件**：`packages/agent/src/hooks/approval.ts`

**内容**：ApprovalHook 类、DANGEROUS_PATTERNS、request_approval()、wait_for_decision()、超时处理

**验证指南**：`packages/agent/verification/20-approval.md`

---

## Phase 7：REPL 核心（4 个任务，可并行）

### [ ] T-21：repl/reflection.ts 反思状态机

**文件**：`packages/agent/src/repl/reflection.ts`

**内容**：run_reflection()、synthesize_skill()、ReflectionState 管理、trigger_count 检查

**验证指南**：`packages/agent/verification/21-reflection.md`

### [ ] T-22：repl/slash.ts 斜杠命令系统

**文件**：`packages/agent/src/repl/slash.ts`

**内容**：SLASH_COMMANDS 表、handle_slash_command()、/exit /clear /skills /compact /help 等命令

**验证指南**：`packages/agent/verification/22-slash.md`

### [ ] T-23：repl/executor.ts 并行 Tool 执行

**文件**：`packages/agent/src/repl/executor.ts`

**内容**：execute_tool_calls_parallel()（safe 并行、guarded 串行）、Approval 集成、结果聚合

**验证指南**：`packages/agent/verification/23-repl-executor.md`

### [ ] T-24：repl/loop.ts REPL 主循环

**文件**：`packages/agent/src/repl/loop.ts`

**内容**：run_repl()、双状态机（Normal/Reflection）、LLM 调用循环、TaskBuffer 管理、ReplContextValue

**验证指南**：`packages/agent/verification/24-repl-loop.md`

---

## Phase 8：REPL UI 组件（1 个任务）

### [ ] T-25：repl/components/ + repl/utils/ REPL TUI 组件

**文件**：
- `packages/agent/src/repl/utils/markdownToInk.ts`
- `packages/agent/src/repl/components/StreamingOutput.tsx`
- `packages/agent/src/repl/components/ApprovalModal.tsx`
- `packages/agent/src/repl/components/ToolProgress.tsx`
- `packages/agent/src/repl/components/BorderBox.tsx`
- `packages/agent/src/repl/components/InputPrompt.tsx`
- `packages/agent/src/repl/components/NotificationBanner.tsx`
- `packages/agent/src/repl/components/ConversationLog.tsx`
- `packages/agent/src/repl/components/UserMessage.tsx`
- `packages/agent/src/repl/components/AssistantMessage.tsx`
- `packages/agent/src/repl/components/App.tsx`
- `packages/agent/src/repl/app.tsx`

**内容**：Ink TUI 组件、流式 Markdown 渲染、Approval 弹窗、工具状态、整体 App 集成

**验证指南**：`packages/agent/verification/25-repl-components.md`

---

## Phase 9：集成（1 个任务）

### [ ] T-26：integration 端到端验证

**验证内容**：
- Agent 完整启动（config → provider → registry → session → repl）
- 用户输入 → LLM 调用 → Tool 执行 → 结果返回 的完整循环
- Approval 弹窗显示
- Session 持久化
- 所有斜杠命令正常工作

**验证指南**：`packages/agent/verification/26-integration.md`

---

## 完成标准

- [ ] 所有 26 个任务验证通过
- [ ] `pnpm build` 编译成功，无 TS 错误
- [ ] `pnpm test` 全部单测通过
- [ ] Agent REPL 可交互运行（模拟输入 + 验证输出）
- [ ] 推送到 GitHub main 分支
