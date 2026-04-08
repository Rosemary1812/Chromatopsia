# T-10：tools/edit.ts Edit Tool

## 验证目标
确认 Edit Tool 能正确替换文件内容，old_string/new_string 逻辑正确，文件不存在时正确报错。

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
cd packages/agent && pnpm test -- tools/edit
```
**预期结果**：测试通过

### 步骤 3：功能验证
```bash
cd packages/agent
echo "hello world" > /tmp/test_edit.txt
node -e "
import('./dist/tools/edit.js').then(m => {
  const r = await m.edit_tool({
    file_path: '/tmp/test_edit.txt',
    old_string: 'world',
    new_string: 'chromatopsia'
  }, { session: {}, working_directory: '/' });
  console.log('Result:', r.success);
});
cat /tmp/test_edit.txt
"
```
**预期结果**：`success: true`，文件内容变为 "hello chromatopsia"

### 步骤 4：old_string 不匹配
```bash
cd packages/agent
node -e "
import('./dist/tools/edit.js').then(m => {
  const r = await m.edit_tool({
    file_path: '/tmp/test_edit.txt',
    old_string: 'notfound',
    new_string: 'x'
  }, { session: {}, working_directory: '/' });
  console.log('Not found:', r.success, r.output);
});
"
```
**预期结果**：`success: false`

## 边界情况

- old_string 有多个匹配：应替换第一个
- old_string 唯一性检查：单测验证唯一性

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 正常替换成功
- [ ] old_string 不匹配时返回错误
- [ ] 越界路径被沙箱拦截

## 注意事项
在 /tmp 中测试，不要在项目目录中测试。
