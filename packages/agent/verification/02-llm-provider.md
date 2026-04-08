# T-02：llm/provider.ts LLM Provider 接口

## 验证目标
确认 LLMProvider 接口定义正确，chat() 和 chat_stream() 签名符合设计。

## 验证前置条件
- T-00 已完成验证
- `pnpm install` 已执行

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：检查接口方法签名
确认 `LLMProvider` 接口包含：
- `name: string`
- `chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>`
- `chat_stream(messages, tools, options?): AsyncGenerator<string, LLMResponse, void>`
- `get_model(): string`

### 步骤 3：检查 StreamOptions
确认 `StreamOptions` 包含：
- `system_hint?: string`
- `on_tool_call_start?: (tool_call: ToolCall) => void`
- `on_tool_call_end?: (tool_call: ToolCall, result: ToolResult) => void`

## 边界情况

- tools 参数为空时：`chat()` 应能正常调用（不使用 tools）
- 流式中途无数据时：`chat_stream()` 应正常返回空 generator

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] LLMProvider 接口方法签名完整
- [ ] StreamOptions 字段完整
- [ ] 导出的类型能被 `index.ts` 引用

## 注意事项
接口定义阶段不涉及实际 API 调用，只验证类型正确性。
