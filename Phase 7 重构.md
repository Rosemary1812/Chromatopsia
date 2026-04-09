# Phase 7 重构设计（临时）

> 基于 2026-04-09 讨论，完整设计文档见 `Program/docs/phase7-reflection-refactor-20260409.md`

---

## 一、核心改动总结

### 1. Reflection 触发机制：Inline → Idle-triggered

**原设计**：每次 tool 执行后检查 `trigger_count >= threshold`，满足则立即触发 Reflection，打断当前 turn。

**新设计**：Reflection 在用户空闲 N 秒后（`idle_timeout`，默认 30s）触发，两个 Normal turn 之间进行，不打断任何 turn。

### 2. Skill 前置匹配

**原设计**：`SkillRegistry.match(task_type)` 只按工具类型匹配，REPL 没有在调用 LLM 前检查 Skill 的逻辑。

**新设计**：每次用户输入先调用 `skillReg.trigger_match(input)`，按 `trigger_pattern` 正则 + `trigger_condition` 关键词 + `name` 模糊匹配。匹配到则直接执行 Skill steps，不调 LLM。

### 3. Skill 执行器

**原设计**：Reflection 合成的 Skill 只有 `register()`，没有执行能力。

**新设计**：新增 `execute_skill(skill)` 函数，逐条执行 `skill.steps`，失败时调用 `SkillPatcher.patch()` 自动校准。

---

## 二、涉及改动的文件清单

### 新建文件（6 个）

| 文件 | 职责 |
|------|------|
| `src/repl/loop.ts` | REPL 主循环（重写） |
| `src/repl/reflection.ts` | Idle-triggered Reflection |
| `src/repl/executor.ts` | Tool 执行器 + Skill 执行器 |
| `src/repl/components/task-buffer.ts` | TaskBuffer 管理 |
| `src/repl/components/idle-detector.ts` | Idle 检测 |
| `src/repl/components/skill-matcher.ts` | Skill 输入匹配（可选拆分） |

### 改动文件（4 个）

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `ReflectionState` 增加 `last_active_at` |
| `src/config.ts` | 新增 `reflection.idle_timeout`、`max_buffer_size` |
| `src/skills/registry.ts` | 新增 `trigger_match(input: string)` |
| `src/index.ts` | 导出新增模块 |

### 不改动的文件

```
src/skills/patcher.ts       ✓ 已完成
src/memory/storage.ts        ✓ 已完成
src/session/                 ✓ 已完成
src/tools/                   ✓ 已完成
src/llm/                     ✓ 已完成
src/hooks/approval.ts       ✓ 已完成（T-20）
src/repl/slash.ts            ✓ 验证通过即可
```

---

## 三、类型改动详情

### `ReflectionState`（types.ts）

```typescript
// 新增 last_active_at
export interface ReflectionState {
  in_progress: boolean;
  task_buffer: TaskBufferEntry[];
  trigger_count: number;
  last_task_type: string | null;
  last_active_at: number;  // 新增
}
```

### `AppConfig`（config.ts）

```typescript
// 新增配置项
export interface ReflectionConfig {
  threshold?: number;       // 现有，默认 3
  idle_timeout?: number;   // 新增，默认 30000ms
  max_buffer_size?: number; // 新增，默认 50
  enabled?: boolean;        // 现有，默认 true
}
```

---

## 四、plan.md 改动

### Phase 7 任务调整为 7 个

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

## 五、Skill 闭环流程

```
Reflection 合成 Skill
        ↓
skillReg.register(skill)
        ↓
用户输入 "帮我看看 git 状态"
        ↓
skillReg.trigger_match(input) → 匹配到 skill
        ↓
execute_skill(skill) → 逐条执行 steps
        ↓
skill.call_count++，失败则 patch
```

---

## 六、Reflection 时序

```
用户 "git status"  → tool → trigger_count=1
用户 "git log"     → tool → trigger_count=2
用户 "git diff"    → tool → trigger_count=3
用户离开 → 30s idle timeout → 触发 Reflection
        → 合成 Skill → 注册 → 重置 trigger_count=0
```

---

## 七、验证重点

1. **Skill 匹配**：输入 "帮我看看 git 状态" 能匹配到 `trigger_pattern: "git"` 的 Skill
2. **Skill 执行**：匹配后直接执行 steps，不调用 LLM
3. **Reflection 不打断 turn**：Reflection 在 idle timeout 触发，不在 tool 执行过程中触发
4. **Reflection 完成后的循环**：Reflection 结束后正确回到等待状态
