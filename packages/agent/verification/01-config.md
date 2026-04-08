# T-01：config/loader.ts 配置加载

## 验证目标
确认 YAML 配置文件能被正确读取，环境变量替换正常工作。

## 验证前置条件
- `pnpm install` 已执行
- 在 `packages/agent/` 下创建 `config.yaml` 测试文件

## 验证步骤

### 步骤 1：创建测试配置文件
```yaml
provider: anthropic
anthropic:
  api_key: ${TEST_API_KEY}
  model: claude-opus-4-6
```

### 步骤 2：TypeScript 编译
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功

### 步骤 3：验证环境变量替换逻辑
检查 `loader.ts` 中存在 `${...}` 的替换逻辑（正则匹配 `\$\{([^}]+)\}` 并从 `process.env` 读取）。

## 边界情况

- `${VAR}` 变量不存在时：`config.yaml` 中使用不存在的变量不应崩溃
- 配置文件不存在时：`load_config()` 应抛出友好错误

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 环境变量 `${...}` 替换逻辑存在
- [ ] 配置文件不存在时的错误处理存在

## 注意事项
实际 API 调用不需要真实 key，只需确认加载逻辑正确。
