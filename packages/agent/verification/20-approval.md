# T-20：hooks/approval.ts Approval 机制

## 验证目标
确认 ApprovalHook 正确识别危险操作，request_approval() 和 wait_for_decision() 正常工作。

## 验证前置条件
- T-08 已完成（需要 DANGEROUS_PATTERNS）

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- hooks/approval
```
**预期结果**：测试通过

### 步骤 3：危险命令识别
```typescript
const hook = new ApprovalHook();

// dangerous 工具
hook.request_approval('run_shell', { command: 'rm -rf /' }, ''); // 应返回 ApprovalRequest

// warning 工具
hook.request_approval('Edit', { file_path: '/etc/passwd' }, ''); // 应返回 ApprovalRequest

// safe 工具
hook.request_approval('Read', { file_path: '/tmp/a.txt' }, ''); // 应返回 null（auto-approve）
```

### 步骤 4：wait_for_decision 超时
5 分钟无响应应自动返回 reject。

## 边界情况

- dangerous 工具全部触发 approval
- warning 工具在危险场景触发（Edit >5 行 / 越界文件）
- auto_approve_safe=false 时 safe 工具也触发

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] DANGEROUS_PATTERNS 正确识别危险命令
- [ ] dangerous 工具全部触发 approval
- [ ] safe 工具返回 null（auto-approve）
- [ ] 超时处理正确

## 注意事项
Approval 的"等待决策"部分在 TUI 集成前无法完全端到端验证，单测 mock 决策流程即可。
