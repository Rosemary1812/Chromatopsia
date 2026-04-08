# T-00：types.ts 全局类型与 index.ts 导出入口

## 验证目标
确认所有全局类型定义完整且无循环依赖，index.ts 正确导出所有公开 API。

## 验证前置条件
- `pnpm install` 已执行
- `cd packages/agent && pnpm build` 能编译

## 验证步骤

### 步骤 1：TypeScript 编译无错误
```bash
cd packages/agent && pnpm build
```
**预期结果**：编译成功，dist/ 目录下生成 .js 和 .d.ts 文件

### 步骤 2：检查类型完整性
```bash
grep -c "export interface\|export type" packages/agent/src/types.ts
```
**预期结果**：数量 >= 15（包含 Message、ToolDefinition、Session、Skill、Approval 等）

### 步骤 3：检查导出完整性
```bash
grep "^export" packages/agent/src/index.ts | wc -l
```
**预期结果**：数量 >= 10（所有主要模块的导出）

## 边界情况

- 循环依赖检查：`pnpm build` 不报 "Circular dependency" 错误
- 所有接口方法有完整参数类型，无 `any`

## 验证通过标准

- [ ] `pnpm build` 编译成功
- [ ] 类型数量完整（>= 15 个 export interface/type）
- [ ] 导出数量完整（>= 10 个 export from index.ts）
- [ ] 无循环依赖警告

## 注意事项
无
