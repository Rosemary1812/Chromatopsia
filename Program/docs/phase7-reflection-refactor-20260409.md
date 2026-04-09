# Phase 7 重构：REPL 核心 + Idle-triggered Reflection + Skill 触发

> 日期：2026-04-09
> 状态：待实施

---

## 一、问题背景

当前 `plan.md` 中 Phase 7 的设计存在以下问题：

### 1. Reflection 触发时机会打断 Normal 流程

原设计在 `handleUserInput` 循环内每次 tool 执行后检查 `trigger_count >= threshold`，**立即触发 Reflection**，这会打断正在进行的 turn。

### 2. Skill 匹配逻辑缺失

`SkillRegistry.match(task_type)` 只按工具类型匹配，不按用户输入匹配。REPL 主循环没有在调用 LLM 前先检查 Skill 的 `trigger_condition` / `trigger_pattern` 的逻辑。

### 3. Skill 执行器缺失

Reflection 合成的 Skill 只有 `register()` 接口，没有根据 Skill 的 `steps` 自动执行的能力。

---

## 二、重构目标

1. **Idle-triggered**：Reflection 在用户空闲 N 秒后触发，不打断 Normal turn
2. **Skill 前置匹配**：每次用户输入先走 Skill 匹配，匹配到则直接执行 Skill steps，不调 LLM
3. **完整 Skill 生命周期**：Reflection → 注册 → 触发执行 闭合

---

## 三、架构图

```
用户输入
    ↓
┌─────────────────────────────────────┐
│  1. 斜杠命令检查（/exit /clear 等）   │  ← 已有，不改
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  2. Skill 触发匹配                   │  ← 新增
│     fuzzy_match(user_input)          │
│     检查 trigger_pattern / trigger_condition
│     匹配 → 执行 Skill steps → 结束    │  ← 新增 SkillExecutor
│     不匹配 → 继续                    │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  3. Normal turn（LLM 调用循环）        │  ← 重写
│     - 调 LLM                         │
│     - 执行 tool_calls                 │
│     - 每次 tool 执行后 trigger_count++│
│     - 追加到 task_buffer             │
│     - 不检查是否触发 Reflection       │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  4. Idle 检测（Promise.race）        │  ← 新增
│     用户无输入 N 秒后                │
│     检查 trigger_count >= threshold  │
│     是 → run_idle_reflection()        │
│     否 → 继续等待                    │
└─────────────────────────────────────┘
```

---

## 四、涉及改动的文件

### 4.1 新建文件

| 文件 | 职责 |
|------|------|
| `src/repl/loop.ts` | REPL 主循环（重写） |
| `src/repl/reflection.ts` | Idle-triggered Reflection 实现 |
| `src/repl/executor.ts` | Skill 执行器 + 并行 tool 执行 |
| `src/repl/components/task-buffer.ts` | TaskBuffer 管理封装 |
| `src/repl/components/idle-detector.ts` | Idle 检测逻辑封装 |
| `src/repl/components/skill-matcher.ts` | Skill 输入匹配逻辑 |
| `src/repl/components/infer-task-type.ts` | task_type 推断 |

### 4.2 改动文件

| 文件 | 改动内容 |
|------|----------|
| `src/types.ts` | `ReflectionState` 增加 `last_active_at` 字段 |
| `src/config.ts` / `src/config/loader.ts` | 新增 `reflection.idle_timeout` 配置项 |
| `src/skills/registry.ts` | 新增 `trigger_match(input: string)` 方法 |
| `src/index.ts` | 导出新增的 REPL 模块 |

### 4.3 不改动的文件（Phase 7 范围外）

| 文件 | 说明 |
|------|------|
| `src/skills/patcher.ts` | 已完成，无需改动 |
| `src/memory/storage.ts` | 已完成，无需改动 |
| `src/session/` | 已完成，无需改动 |
| `src/tools/` | 已完成，无需改动 |
| `src/llm/` | 已完成，无需改动 |
| `src/hooks/approval.ts` | 已在 T-20 实现 |

---

## 五、类型定义改动

### 5.1 `ReflectionState` 新增字段

```typescript
// src/types.ts

export interface ReflectionState {
  in_progress: boolean;          // 防止重复触发
  task_buffer: TaskBufferEntry[];
  trigger_count: number;
  last_task_type: string | null;
  last_active_at: number;        // 新增：最后活跃时间戳（ms），用于 idle 计算
}
```

### 5.2 `AppConfig` 新增配置

```typescript
// src/types.ts 或 config.ts

export interface ReflectionConfig {
  threshold: number;             // 现有，默认 3
  idle_timeout: number;          // 新增，默认 30_000ms
  max_buffer_size: number;       // 新增，默认 50，防止 buffer 无限增长
  enabled: boolean;              // 现有，默认 true
}

export interface AppConfig {
  // ... 现有字段
  reflection?: ReflectionConfig;  // 新增
}
```

---

## 六、Skill 触发匹配（核心新增）

### 6.1 `SkillRegistry.trigger_match()`

```typescript
// src/skills/registry.ts

// 新增方法：按用户输入匹配 Skill
trigger_match(input: string): Skill | null {
  const q = input.toLowerCase();
  let best: Skill | null = null;
  let bestScore = 0;

  for (const skill of this.skills.values()) {
    let score = 0;

    // 1. trigger_pattern 正则匹配（权重最高）
    if (skill.trigger_pattern) {
      try {
        const re = new RegExp(skill.trigger_pattern, 'i');
        if (re.test(input)) score += 100;
      } catch { /* 无效正则，跳过 */ }
    }

    // 2. trigger_condition 关键词匹配
    if (skill.trigger_condition) {
      const tc = skill.trigger_condition.toLowerCase();
      if (q.includes(tc)) score += 50;
      // 关键词重叠计数
      const words = tc.split(/\s+/);
      for (const w of words) {
        if (w.length > 2 && q.includes(w)) score += 10;
      }
    }

    // 3. name 匹配
    if (skill.name.toLowerCase().includes(q)) score += 5;

    if (score > bestScore) {
      bestScore = score;
      best = skill;
    }
  }

  // 阈值：至少得分 > 30 才触发
  return bestScore > 30 ? best : null;
}
```

### 6.2 Skill 执行器

```typescript
// src/repl/executor.ts

async function execute_skill(
  skill: Skill,
  session: Session,
  toolExecutor: ToolExecutor,
  approvalHook: ApprovalHook,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const step of skill.steps) {
    // step 是字符串，需要解析为 ToolCall
    // 格式预期："{tool_name} {args_json}" 或类似结构
    const tool_call = parse_step_to_tool_call(step);
    if (!tool_call) {
      results.push({
        tool_call_id: `step-${results.length}`,
        output: `Failed to parse step: ${step}`,
        success: false,
      });
      continue;
    }

    // 检查 approval
    const approval = approvalHook.request_approval(
      tool_call.name,
      tool_call.arguments,
      `Executing skill step: ${skill.name}`,
    );

    if (approval?.decision === 'reject') {
      results.push({
        tool_call_id: tool_call.id,
        output: 'User rejected skill execution',
        success: false,
      });
      break;
    }

    const finalArgs = approval?.modified_args ?? tool_call.arguments;
    const result = await toolExecutor.execute({ ...tool_call, arguments: finalArgs }, session);
    results.push(result);

    if (!result.success) {
      // skill 执行失败，触发 patch
      break;
    }
  }

  return results;
}

function parse_step_to_tool_call(step: string): ToolCall | null {
  // 简单解析：假设 step 格式为 "tool_name|arg1=value1|arg2=value2"
  // 或更灵活的 JSON: '{"name": "bash", "args": {"command": "..."}}'
  try {
    const parsed = JSON.parse(step);
    if (parsed.name && parsed.args) {
      return { id: uuid(), name: parsed.name, arguments: parsed.args };
    }
  } catch {
    // 不是 JSON，尝试管道分隔格式
    const parts = step.split('|');
    if (parts.length >= 2) {
      const name = parts[0];
      const args: Record<string, unknown> = {};
      for (const pair of parts.slice(1)) {
        const [k, v] = pair.split('=');
        if (k && v !== undefined) args[k] = v;
      }
      return { id: uuid(), name, arguments: args };
    }
  }
  return null;
}
```

---

## 七、主循环 `run_repl()` 伪代码

```typescript
// src/repl/loop.ts

export async function run_repl(ctx: ReplContextValue): Promise<void> {
  const IDLE_TIMEOUT = ctx.config.reflection?.idle_timeout ?? 30_000;
  const REFLECTION_THRESHOLD = ctx.config.reflection?.threshold ?? 3;
  const MAX_BUFFER_SIZE = ctx.config.reflection?.max_buffer_size ?? 50;

  let reflection: ReflectionState = {
    in_progress: false,
    task_buffer: [],
    trigger_count: 0,
    last_task_type: null,
    last_active_at: Date.now(),
  };

  // 初始化 SkillRegistry（从 SkillStore 加载）
  const skillStore = new SkillStore();
  await skillStore.load();
  const skillReg = new SkillRegistry();
  for (const skill of skillStore.getAll()) skillReg.register(skill);

  const toolExecutor = new ToolExecutor(registry, approvalHook);
  const skillPatcher = new SkillPatcher();

  while (true) {
    // ===== 等待用户输入或 idle timeout =====
    const input = await Promise.race([
      readline(),
      delay(IDLE_TIMEOUT).then(() => 'IDLE'),
    ]);

    if (input === 'IDLE') {
      // ===== Idle 触发：检查是否需要 reflection =====
      if (!reflection.in_progress && reflection.trigger_count >= REFLECTION_THRESHOLD) {
        reflection.in_progress = true;
        await run_idle_reflection(ctx, reflection, skillReg, skillStore);
        reflection.in_progress = false;
        // trigger_count 已重置，task_buffer 已清空，last_active_at 已更新
      }
      continue; // 继续等待
    }

    // ===== 用户有输入 =====
    reflection.last_active_at = Date.now();
    ctx.appendUserMessage(input);

    // 1. 斜杠命令
    if (handle_slash_command(input, ctx.session, skillReg)) continue;

    // 2. Skill 触发匹配（关键新逻辑）
    const matchedSkill = skillReg.trigger_match(input);
    if (matchedSkill) {
      ctx.showNotification(`[Skill] 使用技能: ${matchedSkill.name}`);
      const results = await execute_skill(matchedSkill, ctx.session, toolExecutor, ctx.approvalHook);
      for (const r of results) {
        ctx.appendToolResult(r, r.tool_call_id);
      }
      skillReg.update(matchedSkill.id, { call_count: matchedSkill.call_count + 1 });
      // skill 成功执行，可能需要 patch（失败时 patcher 处理）
      continue; // 等待下一条输入
    }

    // 3. Normal turn
    await handle_normal_turn(ctx, reflection, input, skillReg, toolExecutor, skillPatcher);
  }
}

async function handle_normal_turn(
  ctx: ReplContextValue,
  reflection: ReflectionState,
  input: string,
  skillReg: SkillRegistry,
  toolExecutor: ToolExecutor,
  skillPatcher: SkillPatcher,
): Promise<void> {
  // 构建 LLM 上下文
  const taskType = infer_task_type(input);
  const messages = await build_llm_context(ctx.session, taskType, null, skillReg);

  // 首次 LLM 调用
  let response = await ctx.llm.chat(messages, registry.get_all());

  // LLM 调用循环
  while (true) {
    // 如果有 tool_calls，执行它们
    if (response.tool_calls?.length) {
      const results = await execute_tool_calls_parallel(
        response.tool_calls,
        ctx.session,
        toolExecutor,
        ctx.approvalHook,
      );

      // 追加 tool results 到 messages
      messages.push(...results.map((r, i) => ({
        role: 'tool' as const,
        tool_call_id: response.tool_calls![i].id,
        content: r.output,
      })));

      // 更新 reflection 状态
      reflection.last_active_at = Date.now();
      for (const tc of response.tool_calls) {
        if (reflection.last_task_type !== tc.name) {
          reflection.trigger_count = 0;
          reflection.last_task_type = tc.name;
        }
        reflection.trigger_count++;

        // 防 buffer 无限增长
        if (reflection.task_buffer.length >= 50) {
          reflection.task_buffer.shift();
        }

        reflection.task_buffer.push({
          tool_calls: [tc],
          tool_results: [results.find(r => r.tool_call_id === tc.id)!],
          task_type: tc.name,
          session_id: ctx.session.id,
          timestamp: Date.now(),
        });

        ctx.appendToolResult(results.find(r => r.tool_call_id === tc.id)!, tc.name);
      }

      // 继续 LLM 调用
      response = await ctx.llm.chat(messages, registry.get_all());
    } else {
      // 无 tool_calls，输出文本，结束 turn
      ctx.finishAssistantMessage(response.content);
      break;
    }
  }
}
```

---

## 八、Reflection 触发时序

```
Timeline:

T0: 用户 "git status"  → bash tool → trigger_count=1, last_active_at=T0
T1: 用户 "git log"     → bash tool → trigger_count=2, last_active_at=T1
T2: 用户 "git diff"    → bash tool → trigger_count=3, last_active_at=T2
T3: 用户离开
    ...
T3+30s: idle timeout 触发
    检查：!in_progress && trigger_count(3) >= threshold(3) → TRUE
    → run_idle_reflection()
    → 合成 skill
    → 注册到 skillReg + skillStore
    → trigger_count = 0, task_buffer = [], last_active_at = now()
    → 继续等待
```

**关键保证**：
- Reflection 在**两次用户输入的间隙**触发，不打断任何正在进行的 turn
- `in_progress` flag 防止 Reflection 期间再次触发
- `last_active_at` 在每次用户输入和 Reflection 完成后更新

---

## 九、Skill 执行流程（完整闭环）

```
用户: "帮我看看 git 状态"
         ↓
trigger_match("帮我看看 git 状态")
         ↓
匹配到 Skill: "Git 仓库审查" (trigger_pattern: "git")
         ↓
execute_skill(skill)
         ↓
逐条执行 skill.steps:
  Step 1: bash {command: "git status --short"}
  Step 2: bash {command: "git log --oneline -n 10"}
  Step 3: bash {command: "git diff --stat"}
         ↓
聚合结果返回给用户
         ↓
skill.call_count++
```

---

## 十、plan.md 改动

### Phase 7 任务拆分调整

原有 T-21 ~ T-24 需要拆分和调整：

| 原任务 | 调整 |
|--------|------|
| T-21 `repl/reflection.ts` | 重写为 Idle-triggered 版本，新增 `last_active_at` 逻辑 |
| T-22 `repl/slash.ts` | 基本不变，验证通过即可 |
| T-23 `repl/executor.ts` | 新增 Skill 执行器 `execute_skill()` |
| T-24 `repl/loop.ts` | 完全重写，新增 `Promise.race` idle 检测 + Skill 前置匹配 |

新增任务：

| 新任务 | 内容 |
|--------|------|
| T-27 `skills/registry.ts` 新方法 | 新增 `trigger_match(input: string)` |
| T-28 `types.ts` 改动 | `ReflectionState` 增加 `last_active_at` |
| T-29 `config` 改动 | 新增 `reflection.idle_timeout` 和 `max_buffer_size` |

### 更新后的 Phase 7 任务列表

```
## Phase 7：REPL 核心（7 个任务）

### [ ] T-21：repl/reflection.ts 反思状态机（Idle-triggered 重写）

### [ ] T-22：repl/slash.ts 斜杠命令系统（验证通过）

### [ ] T-23：repl/executor.ts 并行 Tool 执行 + Skill 执行器

### [ ] T-24：repl/loop.ts REPL 主循环（完全重写）

### [ ] T-27：skills/registry.ts trigger_match() 新增

### [ ] T-28：types.ts ReflectionState 新增字段

### [ ] T-29：config 新增 reflection 配置项
```

---

## 十一、验证方式更新

### T-24 验证（主循环）

```typescript
// 测试场景：
// 1. 用户输入 → Skill 匹配成功 → 直接执行 skill steps
// 2. 用户输入 → Skill 不匹配 → LLM 调用 → tool 执行
// 3. Idle timeout → trigger_count 达到阈值 → 触发 reflection
// 4. Reflection 期间用户输入 → 队列缓冲，reflection 结束后处理
// 5. 斜杠命令 → 不走 LLM，直接处理
```

### T-27 验证（trigger_match）

```typescript
// 测试场景：
// skill.trigger_pattern = "git.*status"
// input: "帮我看看 git 状态" → 匹配
// input: "git log" → 匹配
// input: "帮我读文件" → 不匹配
```

---

## 十二、风险与边界情况

| 情况 | 处理 |
|------|------|
| reflection 进行中用户输入 | `in_progress` flag 防止重复触发；输入在 reflection 结束后处理 |
| Skill 执行某 step 失败 | 停止执行，调用 `skillPatcher.patch()`，标记 `success_count` |
| Skill 的 `steps` 格式无法解析 | 返回错误，不执行该 step，继续下一步 |
| 多个 Skill 同时匹配 | `trigger_match` 返回得分最高者 |
| `in_progress=true` 期间 idle timeout 再次触发 | 跳过（`in_progress` 为 true） |
