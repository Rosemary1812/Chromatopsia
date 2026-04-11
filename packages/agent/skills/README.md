# Skills

Skill 使用 Markdown 文件存储，`skills.json` 负责记录技能清单索引。

## 目录

- `builtin/`: 内置 Skill
- `templates/skill.template.md`: 用户与 AI 共用模板

运行时用户技能目录：

- `~/.chromatopsia/skills/user/*.md`
- `~/.chromatopsia/skills/drafts/*.md`

运行时清单索引：

- `~/.chromatopsia/skills.json`

## 编写规则

1. 必填 frontmatter 字段：`id`, `name`, `description`, `task_type`, `scope`, `enabled`, `priority`, `updated_at`
2. 正文建议包含以下章节：
   - `## 适用场景`
   - `## 操作步骤`
   - `## 注意事项`
   - `## 验证方式`
3. `id` 必须全局唯一，建议使用 kebab-case。

## 推荐流程

1. 从 `templates/skill.template.md` 复制一份。
2. 填写 frontmatter 与正文。
3. 放入用户目录后重载 Skill（重启或后续增加 `/skill reload`）。
