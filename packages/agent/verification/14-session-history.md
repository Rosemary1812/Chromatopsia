# T-14：session/history.ts Session 持久化

## 验证目标
确认 SessionHistory 能正确读写 JSONL 文件，索引管理正常。

## 验证前置条件
- T-00 已完成

## 验证步骤

### 步骤 1：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 2：单测验证
```bash
cd packages/agent && pnpm test -- session/history
```
**预期结果**：测试通过（使用临时目录，不碰真实数据）

### 步骤 3：验证 JSONL 格式
检查消息追加是否每行一条 JSON，无多余空白：
```
{"role":"user","content":"hello"}
{"role":"assistant","content":"hi"}
```

### 步骤 4：验证 index.json 结构
检查 sessions/index.json 包含 session_id、working_directory、created_at、last_active、message_count。

## 边界情况

- 重复创建同名 session：后者覆盖前者或报错（需明确）
- 损坏的 JSONL 文件：load_session 应能跳过损坏行或报错
- 并发写入：需文件锁或写时安全

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 单测通过
- [ ] append_message 追加正确（一行一条）
- [ ] load_session 正确反序列化
- [ ] archive_session 正确标记 archived
- [ ] list_sessions 正确返回未归档的 session

## 注意事项
所有测试必须在临时目录中进行，不读写 ~/.chromatopsia。
