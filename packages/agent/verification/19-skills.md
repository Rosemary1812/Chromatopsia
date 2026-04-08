# T-19：skills/registry.ts + skills/patcher.ts 技能系统

## 验证目标
确认 SkillRegistry 技能匹配正确，SkillPatcher 自动校准逻辑正常。

## 验证前置条件
- T-18 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- skills
```
**预期结果**：测试通过

### 步骤 3：验证精确匹配
```typescript
registry.register({ id: '1', name: 'test', task_type: 'git-rebase', steps: [], pitfalls: [], trigger_condition: '', call_count: 0, success_count: 0, created_at: 0, updated_at: 0 });
registry.match('git-rebase'); // 应返回该 skill
registry.match('unknown');    // 应返回 null
```

### 步骤 4：验证模糊匹配
fuzzy_match 搜索 trigger_condition 关键词应返回相关技能。

### 步骤 5：验证 Patcher
patch() 应追加新的 pitfalls 和修正 steps，updated_at 应更新。

## 边界情况

- 删除不存在的 skill：`delete()` 无报错
- 重复注册同名 skill：后者覆盖前者
- 空 skill 列表：match/fuzzy_match 返回 null/空数组

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 精确匹配正确
- [ ] 模糊匹配正确
- [ ] register/list/show/delete 正确
- [ ] patch 更新 pitfalls 和 steps

## 注意事项
测试用 mock SkillStore，不依赖真实文件系统。
