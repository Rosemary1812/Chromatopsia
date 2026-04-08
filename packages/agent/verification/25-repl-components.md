# T-25：repl/components/ REPL TUI 组件

## 验证目标
确认所有 Ink 组件正确渲染，markdownToInk 转换正确，App 集成正常。

## 验证前置条件
- T-24 已完成

## 验证步骤

### 步骤 1：TypeScript + Ink 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- repl/components
```
**预期结果**：测试通过

### 步骤 3：markdownToInk 验证
```typescript
markdownToInk('# Hello\n\nWorld'); // 应返回包含 heading + paragraph 的 Ink 节点
markdownToInk('```js\nconsole.log()\n```'); // 应返回代码块节点
markdownToInk('**bold** and *italic*'); // 应返回对应样式节点
```

### 步骤 4：组件渲染验证
确认各组件在 mock Ink 环境（`render()`）中正常渲染无报错：
- App
- ConversationLog
- StreamingOutput
- ApprovalModal
- ToolProgress

### 步骤 5：ApprovalModal 交互
确认上下键选择、a/e/r 快捷键、Enter 确认正确调用 onDecision。

## 边界情况

- 未闭合的 Markdown（流式输出时）：返回 null（不渲染 partial）
- 超长输出：ConversationLog 可滚动
- 流式输出更新：Ink 批处理正确

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过（组件渲染测试）
- [ ] markdownToInk 覆盖主要 Markdown 语法
- [ ] 所有组件 import 无报错
- [ ] ApprovalModal 交互正确

## 注意事项
Ink 组件需要实际调用 `render()` 才能完整测试，这需要终端环境。在 CI 中用 snapshot 测试或 mock render。
