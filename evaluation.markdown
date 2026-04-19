# Chromatopsia Agent 评测方案

> 本文档随讨论持续更新，作为评测工作的 TODO + 决策记录。

---

## 背景与目标

评测一个 Coding Agent 的效果需要系统性的设计。Chromatopsia 是一个基于 LLM 的编程 Agent，拥有完整的工具系统、会话管理、上下文压缩和自学习能力。

---

## 1. Agent 评测通用维度

| 维度 | 含义 | 典型指标 |
|------|------|---------|
| **任务完成率** | Agent 能否独立完成给定任务 | 成功率 / 成功率 + 部分完成率 |
| **响应质量** | 输出是否准确、清晰、有用 | 人工评分 / 任务正确性验证 |
| **效率** | 消耗多少 token、时间、轮次 | Token 消耗、平均工具调用次数 |
| **可靠性 / 鲁棒性** | 能否稳定复现相同结果 | 多次运行一致性 |
| **安全性** | 是否执行危险操作、泄露信息 | 危险操作拦截率 |
| **可观测性** | 决策过程是否可追踪 | 轨迹完整性、中间状态可查 |
| **自主性** | 需要多少人工介入 | Approval 请求次数 / 干预率 |
| **多轮一致性** | 长对话中是否保持上下文 | 30+ 轮对话后任务连贯性 |

---

## 2. Coding Agent 特有维度

Coding Agent 有别于通用 Agent，以下维度更为关键：

| 维度 | 含义 | 为什么重要 |
|------|------|-----------|
| **代码正确性** | 生成的代码是否正确实现需求 | 核心价值 |
| **工具使用效率** | 是否用对工具、用对顺序 | 工具是 Agent 的手脚 |
| **Bug 修复能力** | 能否定位 + 修复 Bug | 常见场景 |
| **上下文利用** | 是否有效读取现有代码库 | 而不是凭空猜测 |
| **Shell 命令安全** | 危险命令是否被拦截 | 破坏性风险 |
| **上下文窗口管理** | 长对话是否触发压缩、截断 | 影响长任务 |
| **跨文件修改一致性** | 多文件修改是否保持一致 | 真实项目场景 |
| **路径沙箱合规性** | 是否只在允许范围内操作 | 安全底线 |
| **学习能力** | 能否从反馈中学习新 Skill | 差异化能力 |
| **Tool Call 序列质量** | 工具调用是否合理、是否有冗余 | 效率关键 |

---

## 3. 评测重点优先级

### 🔴 P0 — 核心能力（必须测）

1. **工具调用正确性**
   - read / glob / grep 是否找对文件、行号
   - edit 是否正确修改指定位置
   - bash 是否在沙箱内执行

2. **任务完成率**
   - 独立完成一个真实任务的比例
   - 典型任务：修复 Bug、新增 Feature、重构、生成测试

3. **上下文理解**
   - 能否读懂项目结构
   - 能否理解现有代码逻辑
   - 能否在长对话中保持状态

### 🟡 P1 — 关键行为（应该测）

4. **危险操作拦截**
   - rm -rf、git reset --hard 等是否触发 approval
   - 路径穿越 ../ 是否被阻止

5. **工具调用效率**
   - 同样的任务用了多少轮工具调用
   - 是否有冗余 / 重复调用

6. **上下文压缩质量**
   - 压缩后是否丢失关键信息
   - 压缩触发时机是否合理

### 🟢 P2 — 差异化能力（可以测）

7. **Skill 学习能力**
   - 能否从多轮对话中提炼出可用 Skill

8. **多会话记忆**
   - 跨会话是否记住项目知识

9. **错误恢复**
   - 工具执行失败后能否恢复

---

## 4. 现有 Trace 基础设施

Chromatopsia **已有完整的 RuntimeEvent 事件系统**，无需从头实现 Trace。

### 已有的事件类型

| 事件 | 触发时机 | 包含信息 |
|------|---------|---------|
| `turn_started` | 每轮对话开始 | 输入文本 |
| `assistant_chunk` | 流式输出每个 chunk | 文本片段 |
| `assistant_message` | LLM 完整响应 | content + tool_calls |
| `tool_started` | 每个工具执行前 | toolCall |
| `tool_finished` | 每个工具执行后 | toolCall + result |
| `tool_batch_finished` | 一批工具执行完 | toolCalls[] + results[] |
| `approval_requested` | 请求危险操作批准 | ApprovalRequest |
| `approval_resolved` | 批准决定做出 | decision |
| `error` | 任何错误 | message |
| `turn_completed` | 整轮对话结束 | 最终 content |

### 核心接口

```typescript
// packages/agent/src/repl/runtime.ts
export interface RuntimeSink {
  emit: (event: RuntimeEvent) => void;
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
}
```

### 缺口

- `RuntimeSink` 是内部推送机制，外部只能通过 `AgentEvents` 回调被动接收
- 缺少轨迹**持久化**（写入文件）
- 缺少 **token 消耗**的采集（目前事件里没有）
- 缺少 **session replay** 支持

---

## 5. 评测框架设计

### 5.1 架构

```
现有 RuntimeSink（事件流）
        ↓
BenchmarkCollector（拦截并持久化）
        ↓
  · 写入 trace.jsonl（每次 tool call 的输入输出）
  · 写入 metadata.json（token 消耗、模型、配置）
  · 支持 session replay
        ↓
  → 评测打分器读取 trace 进行评分
```

**BenchmarkCollector** 是评测专用的 RuntimeSink wrapper，在现有 RuntimeSink 基础上**拦截并持久化**事件流，不修改原有代码。

### 5.2 评测策略

#### 正式评测（Real LLM）
- 用真实的 API key，直连 LLM
- 允许多次运行取平均降低方差
- 记录每次的 token 消耗

#### 快速回归（Recorded Replay）
- 用真实流量录制对话轨迹（包含 LLM 响应 + tool calls）
- 回归时 replay 录制结果，测工具执行层是否正确
- 不测 LLM，只测工具链

### 5.3 任务定义格式（待补充）

每个任务是一个 YAML 文件，定义输入、预期工具序列、预期结果等。

### 5.4 评分器设计（待补充）

- task-completion：文件验证 / Shell 验证 / 人工标注
- tool-efficiency：冗余调用扣分、顺序惩罚
- safety：危险操作拦截率
- context-preservation：压缩前后信息完整性

### 5.5 评测任务集（待补充）

至少 20 个任务，覆盖：
- Bug Fix（8 个）
- Feature（6 个）
- Refactor（4 个）
- DevOps（4 个）

---

## 6. 讨论记录

### 2026-04-18

- [决策] 不 Mock LLM，评测必须用真实 LLM
- [决策] 不从头造 Trace，现有的 RuntimeEvent 系统已经完整
- [决策] BenchmarkCollector 作为 RuntimeSink wrapper，几十行代码，不侵入原有代码
- [待办] 确认评测目标优先级：模型能力 vs 工具链质量 vs Agent 架构
- [待办] 补充评测任务集设计
- [待办] 补充评分器设计
- [待办] 实现 BenchmarkCollector
- [待办] 确定 token 消耗采集方案（当前事件缺少此字段）

---

## 7. 待办事项

- [ ] 实现 BenchmarkCollector（RuntimeSink wrapper + 持久化）
- [ ] 在 RuntimeEvent 中补充 token 消耗字段
- [ ] 设计评测任务集（至少 20 个任务，YAML 格式）
- [ ] 实现评分器（task-completion / tool-efficiency / safety / context-preservation）
- [ ] 实现评测报告生成器
- [ ] 补充 session replay 功能
- [ ] 确定评测目标优先级（P0: 模型能力 / 工具链 / Agent 架构）
