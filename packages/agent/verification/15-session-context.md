# T-15：session/context.ts 上下文构建管道

## 验证目标
确认 build_llm_context() 正确构建发送给 LLM 的消息上下文。

## 验证前置条件
- T-14 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- session/context
```
**预期结果**：测试通过

### 步骤 3：验证上下文结构
检查 build_llm_context() 返回的 messages 包含：
- system prompt（包含项目上下文）
- 匹配的 skill（如果有）
- 最近的对话历史

## 边界情况

- session 无消息：messages 仅包含 system prompt
- skill 匹配多个：fuzzy_match 只取前 3 个
- 超长历史：应在调用前被 SessionManager 压缩

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] system prompt 包含必要信息
- [ ] skill 注入正确（当有匹配时）
- [ ] 无 skill 匹配时无多余注入

## 注意事项
此模块依赖 Session 和 Skill，测试时用 mock。
