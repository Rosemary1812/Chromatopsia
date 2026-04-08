# T-17：session/manager.ts Session 管理器

## 验证目标
确认 SessionManager 能创建、获取、管理 Session，recover_or_prompt() 逻辑正确。

## 验证前置条件
- T-14、T-15、T-16 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- session/manager
```
**预期结果**：测试通过

### 步骤 3：验证 Session 生命周期
- create_session：生成唯一 ID，初始化空 messages
- get_session：能根据 ID 找回
- add_message：追加消息并更新 last_active
- compact()：调用压缩逻辑

### 步骤 4：验证恢复逻辑
- 无活跃 session：创建新 session
- 一个活跃 session：自动恢复
- 多个活跃 session：应提示选择（recover_or_prompt）

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] 创建/获取/追加/清理流程正确
- [ ] compact() 触发压缩
- [ ] recover_or_prompt() 逻辑覆盖三种情况

## 注意事项
测试时 mock SessionHistory，使用临时目录。
