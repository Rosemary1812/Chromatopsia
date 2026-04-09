# Phase 5：Memory + Skills（T-18 & T-19）代码评审

> 日期：2026-04-09
> 状态：T-18 ✓ T-19 ✓（均通过测试）

---

## T-18：memory/storage.ts — SkillStore 持久化层

### 文件
`packages/agent/src/memory/storage.ts`

### 设计

**分层存储**：SkillStore 用内存 Map 做缓存，`~/.chromatopsia/skills.json` 做持久化，实现读时加载、写时刷盘。

**目录结构**：
```
~/.chromatopsia/skills.json   ← 用户 HOME 目录下
```

**核心方法**：
| 方法 | 职责 |
|------|------|
| `load()` | 启动时从磁盘读取，文件不存在/损坏时静默返回空存储 |
| `save(skill)` | 单个 skill 写盘（全量重写） |
| `delete(id)` | 从内存移除并重写磁盘 |
| `byTaskType()` | 按 task_type 精确过滤 |
| `fuzzySearch(query)` | 三维度模糊匹配：task_type / trigger_condition / name，均小写比较 |

**防重**：save 时用 `Map.set(id, skill)` 实现 id 级别覆盖，保证幂等。

**容错**：load 用 try/catch 吞掉 ENOENT 和 JSON 解析错误，初始化为空 Map — 上层不崩溃。

**测试**：全部使用临时目录 `/.test-skill-store-temp`，不碰真实 `~/.chromatopsia`，beforeEach/afterEach 清理。14 个测试全部通过。

### 潜在问题

- 全量写盘：随着 skill 增多会有写放大，可以考虑增量更新
- `load()` 吞掉所有错误包括非 ENOENT 的文件系统错误，可能掩盖权限等问题

---

## T-19：skills/registry.ts + skills/patcher.ts — 技能系统

### 文件
`packages/agent/src/skills/registry.ts`
`packages/agent/src/skills/patcher.ts`

### SkillRegistry 设计

**双索引结构**：
- `Map<id, Skill>` — 主索引，O(1) 按 id 查找
- `Map<task_type, Skill[]>` — 反向索引，支持 `match(task_type)` 快速精确匹配

**关键方法**：
| 方法 | 职责 |
|------|------|
| `match(task_type)` | 返回第一个注册的该类型 skill |
| `fuzzy_match(query)` | 遍历全部 value，匹配 trigger_condition 或 name 的子串 |
| `update()` | 合并 patch 后原地更新两个索引 |
| `delete()` | 同时从两个索引删除，保持一致性 |
| `getById(id)` | O(1) 精确查找（推荐用于精确匹配） |

**问题**：当同一个 `task_type` 注册多个 skill 时，`match()` 只返回第一个。建议后续用 `success_count` 排序或暴露 `getByTaskType()` 返回列表供调用方选择。

### SkillPatcher 设计

**输入**：一个 Skill 实例 + 失败历史 `TaskBufferEntry[]`

**分析维度**（`analyze_failure`）：
- 工具名提取（从 tool_calls）
- 错误信息提取（从 tool_results，过滤掉 `ok`/`OK` 开头）
- 按关键字匹配陷阱模式

**错误 → 陷阱映射**：
| 错误关键字 | 追加的 pitfall |
|-----------|--------------|
| `not found` / `does not exist` | 操作前请确认目标文件或资源存在 |
| `permission denied` / `EACCES` | 注意权限问题，必要时使用 sudo |
| `conflict` / `CONFLICT` | 存在冲突，请先解决冲突再继续 |
| `timeout` / `TIMEOUT` | 操作可能超时，建议增加 timeout |
| git 工具 + 任意错误 | git 操作失败时，用 git status 和 git log 查看 |

**合并逻辑**：
- `pitfalls`：Set 去重后追加新陷阱
- `steps`：已有步骤不重复追加

**副作用**：直接修改传入的 `skill` 对象（引用式更新），调用方需注意。

**测试**：21 个 registry 测试 + 10 个 patcher 测试，全部通过。

---

## 测试结果汇总

```
✓ tests/skills/patcher.test.ts   (10 tests)   10ms
✓ tests/skills/registry.test.ts  (21 tests)   18ms
✓ tests/memory/storage.test.ts     (14 tests)   99ms

Test Files  3 passed (3)
     Tests  45 passed (45)
```

---

## Phase 5 在架构中的位置

```
Session Manager (T-17)
  ├── SessionHistory — 消息持久化
  ├── build_llm_context — 上下文构建
  │
SkillStore (T-18) ←→ ~/.chromatopsia/skills.json
  │
SkillRegistry (T-19) ←→ REPL 反射合成新 Skill
  │
SkillPatcher (T-19) ←→ 失败学习，自动校准 Skill
```

Skill 系统是**自我进化层**：
1. REPL 反思时合成新 Skill → 持久化到 SkillStore
2. 运行时会话通过 SkillRegistry 匹配并注入上下文
3. 失败时 SkillPatcher 自动追加陷阱和修正步骤

---

## 人类可见测试方案

见下方「人类可见测试」专项章节。

---

## 潜在问题汇总

| # | 位置 | 问题 | 严重性 | 建议 |
|---|------|------|--------|------|
| 1 | SkillRegistry.match() | 同一 task_type 多 skill 时返回第一个，结果不确定 | 中 | 用 success_count 排序或暴露 getByTaskType() |
| 2 | SkillStore.load() | 吞掉所有 fs 错误，可能掩盖权限问题 | 低 | 分化 ENOENT 和其他错误处理 |
| 3 | SkillStore.save() | 全量写盘，skill 增多时有写放大 | 低 | 考虑增量写入或 Write-Ahead Log |
| 4 | SkillPatcher | 直接修改传入的 skill 引用，副作用不透明 | 低 | 考虑返回新对象而非就地修改 |

---

## 人类可见测试

目的：验证技能系统和记忆持久化对人类用户是可用的，不仅是单元测试通过，而是端到端可演示。

### Test 1：Skill 端到端演示

**场景**：验证用户可通过 REPL 或脚本完整走完「注册 → 匹配 → 失败学习 → 更新」流程。

**操作步骤**：
```bash
# 1. 启动 Agent（模拟环境）
cd packages/agent && pnpm repl

# 2. 注册一个 Skill（通过 Session Manager 触发合成或直接 API）
/skill add git-rebase --task-type git-rebase --trigger "clean commit history"

# 3. 执行任务触发失败
> git rebase -i HEAD~99
[Error] CONFLICT: Merge conflict detected in src/foo.ts

# 4. 验证 SkillPatcher 自动学习
/skill show git-rebase
# 预期 pitfalls 中新增："存在冲突，请先解决冲突再继续"
# 预期 steps 中新增："遇到冲突时，先用 git status..."

# 5. 持久化验证
cat ~/.chromatopsia/skills.json
# 预期：skills.json 中包含更新后的 git-rebase skill
```

### Test 2：fuzzySearch 交互演示

**场景**：用户在 Skill 列表中模糊搜索，验证返回结果符合预期。

**操作步骤**：
```bash
# 注册多个不同类型的 Skill
/skill add git-rebase --task-type git-rebase --trigger "clean history"
/skill add test-debug --task-type test-debug --trigger "debug failing tests"
/skill add shell-run --task-type shell-exec --trigger "run commands"

/skill search history
# 预期：返回 git-rebase（匹配 trigger_condition "clean history"）

/skill search debug
# 预期：返回 test-debug（匹配 trigger_condition "debug failing tests"）

/skill search TEST
# 预期：返回 test-debug（不区分大小写）

/skill search xyzzy
# 预期：No skills found for "xyzzy".
```

### Test 3：SkillStore 磁盘持久化验证

**场景**：验证 SkillStore 重启后数据不丢失。

**操作步骤**：
```bash
# 1. 创建 SkillStore 实例并保存
node -e "
const { SkillStore } = require('./dist/memory/storage.js');
const store = new SkillStore();
await store.save({ id: 'test-1', name: 'Persistence Test', task_type: 'test', trigger_condition: '', steps: [], pitfalls: [], created_at: Date.now(), updated_at: Date.now(), call_count: 0, success_count: 0 });
console.log('Saved');
"

# 2. 新进程加载，验证数据存在
node -e "
const { SkillStore } = require('./dist/memory/storage.js');
const store = new SkillStore();
await store.load();
const skills = store.getAll();
console.log('Loaded skills:', JSON.stringify(skills, null, 2));
console.log('Count:', skills.length);
# 预期：skills.length === 1, skills[0].name === 'Persistence Test'
"

# 3. 验证删除后磁盘清理
store.delete('test-1');
# 重新 load，验证 skills.json 中该 skill 已移除
```

### Test 4：错误场景验证

**场景**：模拟文件系统异常，验证用户不会看到崩溃。

```bash
# 1. skills.json 损坏
echo "{ invalid json }" > ~/.chromatopsia/skills.json
node -e "
const { SkillStore } = require('./dist/memory/storage.js');
const store = new SkillStore();
await store.load();  // 预期：不抛出异常，返回空 store
console.log('Graceful degradation:', store.getAll().length === 0);
"

# 2. skills.json 不存在
rm ~/.chromatopsia/skills.json
node -e "
const { SkillStore } = require('./dist/memory/storage.js');
const store = new SkillStore();
await store.load();  // 预期：静默创建空 store
console.log('Empty store:', store.getAll().length === 0);
"
```

### Test 5：SkillPatcher 失败学习演示

**场景**：演示 SkillPatcher 如何从真实失败中学习。

```bash
node -e "
const { SkillPatcher } = require('./dist/skills/patcher.js');
const patcher = new SkillPatcher();

const skill = {
  id: 'demo-1',
  name: 'Demo Skill',
  task_type: 'demo',
  trigger_condition: 'run demo',
  steps: ['step 1'],
  pitfalls: [],
  created_at: Date.now(),
  updated_at: Date.now(),
  call_count: 0,
  success_count: 0
};

const failedBuffer = [{
  tool_calls: [{ id: 'tc-1', name: 'Edit', arguments: {} }],
  tool_results: [{
    tool_call_id: 'tc-1',
    success: false,
    output: 'File not found: src/missing.ts'
  }],
  task_type: 'demo',
  session_id: 'session-demo',
  timestamp: Date.now()
}];

await patcher.patch(skill, failedBuffer);
console.log('Pitfalls:', skill.pitfalls);
console.log('Steps:', skill.steps);
console.log('Call count:', skill.call_count);
"
# 预期输出：
# Pitfalls: ['操作前请确认目标文件或资源存在']
# Steps: ['step 1']
# Call count: 1
```

### 执行方式

以上测试可通过以下方式执行：
```bash
# 单元测试（已通过）
cd packages/agent && pnpm test -- memory/storage skills/registry skills/patcher

# 端到端人类可见测试
# 方式1：逐个执行上面的 node 脚本
# 方式2：编写一个集成测试脚本 packages/agent/tests/integration/skill-e2e.test.ts
# 方式3：在 REPL 交互式验证（Phase 7 完成后）
```

### 优先级建议

| 测试 | 优先级 | 理由 |
|------|--------|------|
| Test 1（端到端演示） | 高 | 验证完整流程，人类可观察 |
| Test 5（SkillPatcher） | 高 | 直接验证核心学习逻辑 |
| Test 3（持久化） | 中 | 验证数据不丢失 |
| Test 2（fuzzySearch） | 中 | 验证搜索体验 |
| Test 4（错误场景） | 低 | 容错边界，可后续补充 |
