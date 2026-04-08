# T-07：tools/executor.ts Tool 执行器

## 验证目标
确认 execute_tool() 正确执行单个工具，execute_tool_calls_parallel() 实现并行/串行逻辑，文件沙箱化正常工作。

## 验证前置条件
- T-06 已完成
- 至少一个 Tool 已注册到 registry

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- tools/executor
```
**预期结果**：测试通过

### 步骤 3：沙箱化验证
在单测中验证：
- `resolve_path('/etc/passwd', '/project')` 抛出 Sandbox 错误
- `resolve_path('../etc/passwd', '/project')` 抛出 Sandbox 错误
- `resolve_path('src/index.ts', '/project')` 解析为 `/project/src/index.ts`

### 步骤 4：并行执行验证
- safe 工具应并行执行
- dangerous 工具应串行执行

## 边界情况

- 未知 tool：`execute_tool()` 返回错误 ToolResult（success: false）
- 参数校验失败：返回 Zod 错误 ToolResult
- 工具执行抛出异常：捕获并返回 success: false

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 沙箱路径校验正确拦截越界路径
- [ ] DENIED_PATTERNS 正确拒绝危险命令
- [ ] 并行/串行逻辑正确

## 注意事项
沙箱测试必须覆盖越界绝对路径、相对路径 `..`、空字符串等边界。
