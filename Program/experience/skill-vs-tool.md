# Skill vs Tool：经验积累的选型决策

> **给 Claude Code 的说明**：本文档是 Chroma 项目开发过程中的技术决策记录，供人类（开发者）参考阅读。Claude Code 在执行任务时**不需要**主动关注此文件的内容，除非被人类明确询问。
>
> 类似的经验文档统一放在 `Program/experience/` 目录下，按主题分类。

---

## 结论

**默认生成 Skill**。反思阶段生成的 90% 是项目/任务相关的经验知识，不值得变成 Tool。

## 核心区别

| | Tool | Skill |
|---|---|---|
| LLM 交互方式 | LLM **调用**它（tool_calls） | LLM **阅读**它（注入 system hint） |
| 表达能力 | 受 input_schema 限制，原子动作 | 任意结构化知识：步骤、陷阱、验证 |
| 粒度 | 粗（独立原子操作） | 细（可包含判断分支、多步骤、注意事项） |
| 持久性 | 永久修改 action space | 上下文注入，不改变 LLM 的工具边界 |
| 失败处理 | 失败需重试或换工具 | 失败则退回正常试错路径 |
| 适用场景 | 通用原子能力（Read/Grep/Edit） | 项目/任务相关的经验流程 |

## 为什么 Skill 更适合"反思生成的经验"

1. **经验本质是知识，不是动作**
   反思产出的内容典型如：
   > 先查 `package.json` 确认依赖版本 → 再改 `vite.config.ts` → 注意 `.env` 不要提交 → 最后跑 `npm test` 验证
   >
   > 这不是 `execute(command)` 这种原子动作，而是包含判断、顺序、注意事项、验证方法的**复合流程**，塞不进 Tool 的 input_schema。

2. **Tool 生成 Tool 容易过度工程化**
   - 反思触发的 skill 很多是**临时经验**（"这个 monorepo 要先跑 bootstrap"）
   - 如果固化成 Tool，每次对话都要带着它，但下个项目完全用不上，白白消耗 context
   - Skill 按需加载，不污染全局 action space

3. **Skill 可以渐进变成 Tool**
   ```
   临时经验（Skill，session scoped）
         ↓
   连续验证通过 + 跨 session 复用
         ↓
   稳定模式 → promote 为 Tool（全局注册）
         ↓
   广泛使用后发现问题
         ↓
   降级回 Skill 或删除
   ```

## 什么时候该生成 Tool

只有当一个 pattern 满足以下**全部条件**时，才值得从 Skill 升格为 Tool：

1. 触发条件**精确且稳定**（不因项目不同而变化）
2. 操作是**幂等原子动作**
3. **跨项目通用**（不是某个项目的特殊流程）
4. 验证方式**可自动化**

### 可以升 Tool 的例子

- 自动给 import 排序（通用、原子、可自动化验证）
- 自动添加 copyright header（通用、幂等、可 CI 验证）

### 不应该升 Tool 的例子

- "这个项目的数据库迁移流程"（项目相关）
- "这个 monorepo 要先跑 bootstrap 再跑 build"（临时经验）
- "用户喜欢我先解释再动手"（用户偏好，非工具能力）

## 相关设计决策

- Skill 的触发：反思机制（连续 N 次同类操作无 skill 命中）
- Skill 的校准：使用中遇到错误自动 patch pitfalls/steps
- Skill 的生命周期：生成 → 验证 → 使用 → 校准 → 淘汰（stale）
- Skill 的加载：按 task_type 按需加载（渐进披露），不是全量加载

## 参考

- Hermes Agent 自学习设计
- Claude Code 的工具设计模式
- DeerFlow 的 memory 架构对比

---

*本文档由 Claude 与开发者共同讨论生成，沉淀于 2026-04-08*
