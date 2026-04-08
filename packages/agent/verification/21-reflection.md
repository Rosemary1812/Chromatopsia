# T-21：repl/reflection.ts 反思状态机

## 验证目标
确认 run_reflection() 能根据 TaskBuffer 生成 Skill，trigger_count 逻辑正确。

## 验证前置条件
- T-19 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- repl/reflection
```
**预期结果**：测试通过（mock LLM）

### 步骤 3：验证触发逻辑
- trigger_count < REFLECTION_THRESHOLD：不触发
- trigger_count >= REFLECTION_THRESHOLD：触发
- 不同 task_type：重置 trigger_count

### 步骤 4：验证合成结果
run_reflection() 应返回 SynthesisResult，skill 字段符合 Skill 格式。

## 边界情况

- TaskBuffer 为空：不触发
- 合成结果无有效 skill：返回空 skill 对象
- 不值得固化的操作：synthesis.skill 为空

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 触发阈值正确
- [ ] TaskBuffer 累积正确
- [ ] 合成结果格式正确
- [ ] ReflectionState 重置正确

## 注意事项
单测 mock LLM 调用，不真实调用 API。
