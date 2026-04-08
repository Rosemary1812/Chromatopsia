# T-23：repl/executor.ts 并行 Tool 执行

## 验证目标
确认 execute_tool_calls_parallel() 正确实现 safe 并行、guarded 串行，Approval 集成正确。

## 验证前置条件
- T-07、T-20 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- repl/executor
```
**预期结果**：测试通过

### 步骤 3：验证并行执行
注册 3 个 safe 工具，执行并行调用，验证它们同时开始（可用时间戳判断并行性）。

### 步骤 4：验证串行执行
执行包含 dangerous 工具的调用链，验证按顺序执行（上一个完成后下一个才开始）。

### 步骤 5：Approval 集成
mock ApprovalHook，确认 dangerous 工具调用前先 request_approval()。

## 边界情况

- 空 tool_calls：返回空数组
- 全部 safe：全部并行
- 全部 dangerous：全部串行
- Approval reject：跳过执行，返回拒绝信息

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] safe 并行正确（3+ 工具同时执行）
- [ ] dangerous 串行正确（顺序执行）
- [ ] Approval 拦截正确
- [ ] reject 跳过执行

## 注意事项
并行性验证可通过 mock 时间或 Promise.race 实现。
