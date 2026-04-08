# T-13：tools/webfetch.ts WebFetch Tool

## 验证目标
确认 WebFetch Tool 能获取网页内容并转换为 Markdown。

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
cd packages/agent && pnpm test -- tools/webfetch
```
**预期结果**：测试通过（mock HTTP + Turndown）

### 步骤 3：功能验证（需要网络）
```bash
cd packages/agent
node -e "
import('./dist/tools/webfetch.js').then(m => {
  const r = await m.webfetch_tool({
    url: 'https://example.com',
    prompt: 'what is the main heading'
  }, { session: {}, working_directory: '/' });
  console.log('Success:', r.success);
  const parsed = JSON.parse(r.output);
  console.log('Has content:', !!parsed.content);
  console.log('Has title:', !!parsed.title);
});
"
```
**预期结果**：`success: true`，包含 content 和 title

## 边界情况

- 无效 URL：返回 `success: false`
- 超时（15s）：返回超时错误
- HTML 转 Markdown 失败：返回原始文本（降级）

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过（mock HTTP）
- [ ] 实际获取返回 content
- [ ] 返回包含 title 字段
- [ ] 超时处理正确
- [ ] 无效 URL 处理正确

## 注意事项
网络测试需要实际联网。如果网络不可用，跳过步骤 3，只验证单测通过即可。
