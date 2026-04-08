# T-03：llm/index.ts Provider 工厂函数

## 验证目标
确认 createProvider() 能根据 type 正确路由到对应 Provider。

## 验证前置条件
- T-01、T-02 已完成
- Anthropic/OpenAI SDK 已安装

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：检查路由逻辑
确认 `createProvider('anthropic', config)` 返回实现了 LLMProvider 接口的对象。
确认 `createProvider('openai', config)` 同理。

### 步骤 3：检查未知 type 处理
```typescript
createProvider('unknown' as any, config)
```
**预期结果**：抛出 `Error('Unknown provider: unknown')`

## 边界情况

- 空字符串 type：`createProvider('', config)` 应抛出错误
- config 缺少 api_key：Provider 初始化时应报错或留到调用时报错

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] anthropic/openai 路由正确
- [ ] 未知 type 抛出错误
- [ ] 从 `index.ts` 能正确 import `createProvider`

## 注意事项
不需要真实 API Key，用 mock 验证路由逻辑即可。
