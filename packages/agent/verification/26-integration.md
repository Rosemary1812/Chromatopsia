# T-26：integration 端到端验证

## 验证目标
确认 Agent 完整启动并能执行一个真实任务循环。

## 验证前置条件
- T-00 ~ T-25 全部验证通过
- `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` 已配置

## 验证步骤

### 步骤 1：完整编译
```bash
cd packages/agent && pnpm build && pnpm typecheck
```
**预期结果**：全部编译成功，无 TS 错误

### 步骤 2：运行 REPL
```bash
cd packages/agent && timeout 10 pnpm dev <<EOF
/help
/exit
EOF
```
**预期结果**：REPL 启动，显示欢迎 banner，/help 输出帮助文本，/exit 正常退出

### 步骤 3：单测全覆盖
```bash
cd packages/agent && pnpm test
```
**预期结果**：全部单测通过

### 步骤 4：真实任务循环（可选，需要真实 API Key）
```bash
cd packages/agent && echo "列出 packages/agent/src 目录下的所有 TypeScript 文件" | timeout 30 pnpm dev
```
**预期结果**：Agent 调用 Glob 工具，返回 .ts 文件列表，输出到终端

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] `pnpm test` 全部通过
- [ ] REPL 启动正常
- [ ] /help 命令输出正确
- [ ] /exit 正常退出
- [ ] index.ts 导出所有公开 API

## 最终 git 推送

验证全部通过后，执行：
```bash
git add -A && git commit -m "feat(agent): complete phase 1 - interactive coding agent

All 26 tasks implemented and verified.
- LLM Provider (Anthropic + OpenAI)
- Tool System (7 built-in tools + sandboxing)
- Session Management (persistence + compression)
- Memory & Skills (cross-session learning)
- REPL TUI (Ink-based terminal interface)

Verified by: human
Co-Authored-By: Claude <noreply@anthropic.com>" && git push
```

## 注意事项
如果无真实 API Key，步骤 4 可以跳过，但步骤 1-3 必须全部通过。
