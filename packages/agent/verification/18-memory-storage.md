# T-18：memory/storage.ts 记忆持久化

## 验证目标
确认 SkillStore 能正确读写 skills.json，fuzzySearch 逻辑正确。

## 验证前置条件
- T-00 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- memory/storage
```
**预期结果**：测试通过（使用临时目录，不碰真实 ~/.chromatopsia）

### 步骤 3：验证存储格式
确认 skills.json 格式：
```json
[{
  "id": "skill-001",
  "name": "Git Rebase",
  "task_type": "git-rebase",
  "steps": ["..."],
  "pitfalls": ["..."],
  ...
}]
```

### 步骤 4：fuzzySearch 验证
- task_type 匹配
- trigger_condition 关键词匹配
- name 匹配
均不区分大小写。

## 边界情况

- skills.json 不存在：应创建空数组
- skills.json 格式损坏：应抛出友好错误或返回空数组
- 大量 skill（>100）：fuzzySearch 性能可接受（内存遍历）

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] save/load 循环正确
- [ ] fuzzySearch 三种匹配都正确
- [ ] 空/损坏文件处理正确

## 注意事项
所有测试在临时目录中进行。
