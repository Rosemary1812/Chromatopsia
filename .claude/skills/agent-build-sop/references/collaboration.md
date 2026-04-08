# Chromatopsia Agent 协作规范

## Commit 格式

收到用户「✅ T-XX 验证通过」后，执行：

```bash
git add .
git commit -m "$(cat <<'EOF'
feat(agent): {简短描述}

{详细说明（可选）}

Co-Authored-By: Claude <noreply@anthropic.com>
Verified by: human
Task: T-XX
EOF
)"
git push -u origin t{xx}-{name}
```

---

## 分支策略

| 分支 | 来源 | 用途 |
|------|------|------|
| `main` | — | 稳定基准，只接收已验证的合并 |
| `t{xx}-{name}` | `main` | 单个任务开发分支，完成后合并回 main |

### 分支生命周期

1. 基于最新 main 创建：`git checkout main && git pull && git checkout -b t{xx}-{name}`
2. 开发、测试、提交
3. 用户验证通过后，合并到 main
4. 删除本地和远程开发分支

---

## 代码规范

### 注释规范

| 情况 | 写 | 不写 |
|------|----|------|
| 文件顶部 | 模块用途 + T-XX 标记 | — |
| 导出函数/类 | JSDoc 说明参数/返回值/含义 | 明显的逻辑不逐行解释 |
| 非显而易见的分支/边界 | `// 这里用 X 是因为 Y` | 自明的 if/else |
| 占位符实现 | `// TODO(T-XX): 实现 XXX` | — |

**原则**: 注释解释 *why*，不解释 *what*。

### 函数设计

- 单一职责，命名即文档（`createProvider` 而非 `makeProvider`）
- 避免副作用散落，状态集中在明确的地方
- 导出函数必须有类型签名（不接受 `any`）
- 优先使用 `async/await` 而非原始 Promise 链

### 测试命名

```
it('should return 401 when api_key is invalid')  ✓
it('api test')                                   ✗
```

测试名即规格，说明预期行为。每个测试描述一个具体行为。

### 文件结构

```
packages/agent/src/{module}/
  ├── {module}.ts        # 主要导出
  ├── {sub}.ts           # 子模块（按需）
  └── index.ts           #  barrel export
```

### 禁止事项

- ❌ 不写空注释占位（`// TODO` 除外）
- ❌ 不写解释显而易见代码的注释
- ❌ 不留 `console.log` 调试代码
- ❌ 不提交有 `// TODO` 但附有伪造信息的注释
- ❌ 不在 `types.ts` / `index.ts` 已有内容之外进行修改（T-00 固定）

---

## 代码审查 Checklist（自检）

提交前确认：

- [ ] `pnpm build` 编译成功
- [ ] `pnpm test` 所有测试通过
- [ ] 导出的类型/函数有 JSDoc（或已在 DESIGN.md 中说明）
- [ ] 无 `console.log` 残留
- [ ] 无 TODO 伪造信息
- [ ] commit message 格式正确
