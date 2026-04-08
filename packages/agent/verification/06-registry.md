# T-06：tools/registry.ts Tool 注册表

## 验证目标
确认 ToolRegistry 的注册、查询、过滤功能正常工作。

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
cd packages/agent && pnpm test -- tools/registry
```
**预期结果**：测试通过

### 步骤 3：手动验证注册逻辑
```typescript
import { registry } from './packages/agent/src/tools/registry.ts';
// 注册一个测试 tool
registry.register({ name: 'test_tool', description: 'test', input_schema: {}, handler: async () => ({ tool_call_id: '1', output: 'ok', success: true }) });
// 查询
const t = registry.get('test_tool');
// t 应存在
```

## 边界情况

- 注册同名 tool：后者覆盖前者
- 查询不存在的 tool：`get()` 返回 undefined

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] register/get/get_all/get_dangerous 四个方法都正确
- [ ] 空注册表 `get_all()` 返回空数组

## 注意事项
单测覆盖：注册、重复注册、查询、查询不存在、get_all、get_dangerous。
