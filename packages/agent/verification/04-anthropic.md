# T-04：llm/anthropic.ts Anthropic Provider

## 验证目标
确认 AnthropicProvider 正确实现 LLMProvider 接口，能发送消息并解析 tool_use 响应。

## 验证前置条件
- T-03 已完成
- `ANTHROPIC_API_KEY` 环境变量已设置（或测试用 mock）

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- llm/anthropic
```
**预期结果**：测试通过（mock HTTP 响应，不走真实 API）

### 步骤 3：检查 tool_calls 转换
确认 Anthropic 的 `content_block.source` 格式正确转换为内部 `ToolCall` 格式。

## 边界情况

- API 返回非 tool_use：`finish_reason === 'stop'` 时 `tool_calls` 为空
- 网络超时：应有重试逻辑（指数退避）
- API Key 无效：应抛出可读错误

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] tool_calls 格式转换正确
- [ ] 错误处理完善
- [ ] 流式输出是 AsyncGenerator

## 注意事项
单测必须 mock `@anthropic-ai/sdk`，不依赖真实 API。
