# T-12：tools/websearch.ts WebSearch Tool

## 验证目标
确认 WebSearch Tool 能调用 DuckDuckGo 并返回结构化搜索结果。

## 验证前置条件
- T-07 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- tools/websearch
```
**预期结果**：测试通过（mock HTTP）

### 步骤 3：功能验证（需要网络）
```bash
cd packages/agent
node -e "
import('./dist/tools/websearch.js').then(m => {
  const r = await m.websearch_tool({
    query: 'what is typescript'
  }, { session: {}, working_directory: '/' });
  console.log('Success:', r.success);
  const parsed = JSON.parse(r.output);
  console.log('Results count:', parsed.results?.length);
});
"
```
**预期结果**：`success: true`，results 数组包含搜索结果（至少 1 条）

## 边界情况

- 无网络连接：返回 `success: false`，错误信息说明网络问题
- 空 query：应返回错误
- 搜索无结果：返回空数组（success: true）

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过（HTTP mock）
- [ ] 实际搜索返回结构化结果
- [ ] 结果包含 title、url、snippet
- [ ] 空查询处理正确

## 注意事项
网络测试需要实际联网。如果网络不可用，跳过步骤 3，只验证单测通过即可。
