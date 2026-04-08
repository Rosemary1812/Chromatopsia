# T-09：tools/read.ts Read Tool

## 验证目标
确认 Read Tool 能正确读取文件，支持 offset/limit，文件不存在时正确报错。

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
cd packages/agent && pnpm test -- tools/read
```
**预期结果**：测试通过

### 步骤 3：功能验证
创建临时测试文件：
```bash
cd packages/agent
echo -e "line1\nline2\nline3\nline4\nline5" > /tmp/test_read.txt
node -e "
import('./dist/tools/read.js').then(m => {
  const r1 = await m.read_tool({ file_path: '/tmp/test_read.txt' }, { session: {}, working_directory: '/' });
  console.log('Full:', r1.output.split('\n').length, 'lines');
  const r2 = await m.read_tool({ file_path: '/tmp/test_read.txt', offset: 1, limit: 2 }, { session: {}, working_directory: '/' });
  console.log('Slice:', r2.output);
});
"
```
**预期结果**：
- Full: 5 行
- Slice: 包含 "line2" 和 "line3"

### 步骤 4：越界文件验证
```bash
node -e "
import('./dist/tools/read.js').then(m => {
  const r = await m.read_tool({ file_path: '/nonexistent/file.txt' }, { session: {}, working_directory: '/' });
  console.log('Not exist:', r.success, r.output);
});
"
```
**预期结果**：`success: false`，包含 "not found" 或类似信息

## 边界情况

- 越界路径读取：沙箱应拦截（基于 executor 层）
- offset > 文件行数：返回空内容
- limit 未指定：默认最多 500 行

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 正常文件读取成功
- [ ] offset/limit 正确工作
- [ ] 文件不存在返回 success: false
- [ ] 越界路径被沙箱拦截

## 注意事项
在 /tmp 中测试，不要在项目目录中测试。
