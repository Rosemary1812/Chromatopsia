# Skills

Skill 使用 Markdown guidance package 存储。运行时只扫描 frontmatter 生成轻量索引；完整 `SKILL.md` 正文只在用户 slash 调用或模型调用 `Skill` tool 时按需加载。

## 目录

- `builtin/<skill-id>/SKILL.md`: 内置 Skill，推荐目录型格式
- `templates/skill.template.md`: 用户与 AI 共用模板

运行时用户技能目录：

- `<project>/.chromatopsia/skills/user/<skill-id>/SKILL.md`
- `<project>/.chromatopsia/skills/drafts/<skill-id>/SKILL.md`

兼容期仍可读取旧的单文件 `.md`，但新 Skill 应使用目录型 `SKILL.md`。

运行时清单索引：

- `<project>/.chromatopsia/skills/index.json`

## 编写规则

1. 必填 frontmatter 字段：`id`, `name`, `description`, `task_type`, `scope`, `enabled`, `priority`, `updated_at`。
2. 正文是给 Agent 阅读的 Markdown 指导，不会被解析成 tool call，也不要写成可执行宏。
3. 推荐正文包含：`## When To Use`, `## Procedure`, `## Verification`，也可以按具体领域组织章节。
4. `id` 必须全局唯一，建议使用 kebab-case。

## 推荐流程

1. 从 `templates/skill.template.md` 复制一份到 `<skill-id>/SKILL.md`。
2. 填写 frontmatter 与 guidance 正文。
3. 放入用户目录后重载 Skill（重启或后续增加 `/skill reload`）。
