# T-22：repl/slash.ts 斜杠命令系统

## 验证目标
确认所有斜杠命令正确处理并返回预期结果。

## 验证前置条件
- T-17、T-19 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- repl/slash
```
**预期结果**：测试通过

### 步骤 3：验证所有命令
| 命令 | 输入 | 预期行为 |
|------|------|---------|
| /exit | /exit | process.exit(0) |
| /quit | /quit | process.exit(0) |
| /clear | /clear | session.clear() 被调用 |
| /skills | /skills | skill_reg.list() 被调用 |
| /skill | /skill git-rebase | skill_reg.show('git-rebase') 被调用 |
| /forget | /forget git-rebase | skill_reg.delete('git-rebase') 被调用 |
| /compact | /compact | session.compact() 被调用 |
| /search | /search rebase | skill_reg.search('rebase') 被调用 |
| /help | /help | 输出帮助文本 |

### 步骤 4：非斜杠命令
`handle_slash_command('hello world', ...)` 应返回 false。

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 所有 9 个命令处理正确
- [ ] 参数解析正确
- [ ] 非斜杠命令返回 false

## 注意事项
/exit 命令在测试中需要 mock process.exit，防止测试进程退出。
