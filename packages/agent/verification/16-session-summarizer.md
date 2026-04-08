# T-16：session/summarizer.ts 自动压缩

## 验证目标
确认 compress_session() 能正确压缩长对话，保留首尾消息。

## 验证前置条件
- T-04 或 T-05 已完成（需要 LLM 调用）

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- session/summarizer
```
**预期结果**：测试通过（mock LLM 调用）

### 步骤 3：验证压缩逻辑
- compress_threshold 触发压缩
- preserve_recent 保留最近 N 条
- min_summarizable 不足则直接截断
- 压缩后消息数量减少但内容完整

### 步骤 4：Metadata 记录
检查压缩后附加 CompressionMetadata（type、original_count、preserved_count）。

## 边界情况

- 消息数量不足 min_summarizable：直接截断（type: 'truncate'）
- 超过 compress_threshold 但无 LLM：直接截断
- 压缩后仍超限：递归压缩

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 阈值触发正确
- [ ] 截断策略正确
- [ ] Metadata 记录正确
- [ ] 摘要消息格式正确（带【历史摘要】标签）

## 注意事项
单测使用 mock LLM，不真实调用 API。
