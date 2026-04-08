# T-08：tools/bash.ts Bash Tool

## 验证目标
确认 run_shell Tool 能执行命令，沙箱化正确，危险命令触发识别。

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
cd packages/agent && pnpm test -- tools/bash
```
**预期结果**：测试通过

### 步骤 3：功能验证（临时文件）
创建临时目录进行实际命令执行测试：
```bash
cd packages/agent
node -e "
import('./dist/tools/bash.js').then(m => {
  const result = await m.run_shell({ command: 'echo hello' }, { session: {}, working_directory: process.cwd() });
  console.log(result);
});
"
```
**预期结果**：`output` 包含 "hello"，`success: true`

### 步骤 4：危险命令识别
```bash
cd packages/agent
node -e "
import('./dist/tools/bash.js').then(m => {
  const result = await m.run_shell({ command: 'rm -rf /' }, { session: {}, working_directory: process.cwd() });
  console.log(result);
});
"
```
**预期结果**：`success: false`，output 包含拒绝原因

## 边界情况

- 超时处理：命令超时（默认 60s）应返回超时错误
- 空命令：应返回错误
- stderr 输出：应一并返回在 output 中

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 正常命令执行成功
- [ ] `rm -rf /` 类危险命令被拦截
- [ ] `git push --force` 被拦截
- [ ] 超时处理正确

## 注意事项
在临时目录中测试，不要在实际项目目录中测试 `rm` 命令。
