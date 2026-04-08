# T-24：repl/loop.ts REPL 主循环

## 验证目标
确认 run_repl() 主循环正确处理用户输入、LLM 调用、Tool 执行、双状态机切换。

## 验证前置条件
- T-03、T-07、T-17、T-19、T-21、T-22、T-23 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- repl/loop
```
**预期结果**：测试通过

### 步骤 3：验证单轮对话
mock LLM + ToolExecutor，调用 handleUserInput('hello')，验证：
- 用户消息加入 session
- LLM 被调用
- tool_calls 执行后结果注入
- 最终 assistant 回复加入 session

### 步骤 4：验证斜杠命令
`handleUserInput('/help')` 应不调用 LLM，直接处理。

### 步骤 5：验证无 tool_calls
当 LLM 返回纯文本（无 tool_calls）时，循环正确结束。

## 边界情况

- LLM 返回多个 tool_calls：全部执行后再继续
- tool 执行失败：错误信息注入，继续循环
- 反射触发：ReflectionState 切换

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 完整对话循环正确
- [ ] 斜杠命令不触发 LLM
- [ ] 多 tool_calls 全部执行
- [ ] 双状态机切换正确

## 注意事项
单测 mock 所有外部依赖（LLM、ToolExecutor、ApprovalHook），测试主循环逻辑。
