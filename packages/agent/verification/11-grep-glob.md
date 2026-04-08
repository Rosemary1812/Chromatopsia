# T-11：tools/grep.ts + tools/glob.ts Grep & Glob Tools

## 验证目标
确认 Grep Tool 能正则搜索文件，Glob Tool 能按模式匹配文件。

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
cd packages/agent && pnpm test -- tools/grep && pnpm test -- tools/glob
```
**预期结果**：测试通过

### 步骤 3：Grep 功能验证
```bash
cd packages/agent
echo -e "function foo() {}\nfunction bar() {}\n// comment" > /tmp/test_grep.txt
node -e "
import('./dist/tools/grep.js').then(m => {
  const r = await m.grep_tool({
    pattern: 'function',
    path: '/tmp/test_grep.txt'
  }, { session: {}, working_directory: '/' });
  console.log('Grep result:', r.output);
});
"
```
**预期结果**：output 包含两行 "function ..."

### 步骤 4：Glob 功能验证
```bash
cd packages/agent
node -e "
import('./dist/tools/glob.js').then(m => {
  const r = await m.glob_tool({
    pattern: '*.ts',
    path: '/tmp'
  }, { session: {}, working_directory: '/' });
  console.log('Glob result:', r.success, r.output.slice(0, 200));
});
"
```
**预期结果**：`success: true`，output 包含 /tmp 下的 .ts 文件

## 边界情况

- Grep 无匹配：返回空结果（success: true，output 为空）
- Glob 无匹配：返回空数组
- 越界路径：沙箱拦截

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] Grep 正则匹配正确
- [ ] Grep context 参数正确（若实现）
- [ ] Glob `*` 和 `**/*` 模式正确
- [ ] 越界路径被沙箱拦截

## 注意事项
在 /tmp 中测试，不要在项目目录中测试。
