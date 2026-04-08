# T-05：llm/openai.ts OpenAI Provider

## 验证目标
确认 OpenAIProvider 正确实现 LLMProvider 接口，能发送消息并解析 function_call 响应。

## 验证前置条件
- T-03 已完成
- `OPENAI_API_KEY` 环境变量已设置（或测试用 mock）

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- llm/openai
```
**预期结果**：测试通过（mock HTTP 响应）

### 步骤 3：检查 Function Calling 转换
确认 OpenAI 的 `function_call` 格式正确转换为内部 `ToolCall` 格式。

## 边界情况

- API 返回非 function_call：`finish_reason === 'stop'` 时 `tool_calls` 为空
- 模型不支持 tools：`openai` 参数降级处理

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] Function Calling 格式转换正确
- [ ] 错误处理完善

## 注意事项
单测必须 mock `openai` SDK，不依赖真实 API。
