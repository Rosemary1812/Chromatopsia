# 外围基建设计

本目录收集画布、悬浮窗、侧边栏等外围 UI 组件的设计方案。

---

## 设计文档

| 文档 | 说明 |
|------|------|
| `voice-input.md` | 语音输入模块（语音→文本→指令，用户自配 ASR API） |
| TBD | 其他规划中 |

---

### 主题

#### 画布
- 无限画布渲染（Canvas Engine）
- 项目卡片（Project Card）
- 终端面板（Terminal Panel）
- 画布布局持久化
- 视图模式切换（Canvas / List）

#### 悬浮窗
- Mini Widget
- 决策卡片（悬浮窗内处理）
- 全局快捷键唤起

#### 侧边栏（从 Codex 汲取灵感）
- 文件目录（文件树，点击查看）
- Diff 视图（git diff / worktree diff）
- MD 渲染（Markdown 直接渲染 + 编辑）
- Worktree 管理（增删切换）

---

## 实现笔记

TBD — 开发过程中记录

---

## 相关文件

- `dream.md` — 原始草稿（含画布、悬浮窗设计愿景）
- `design.md` — 完整设计文档
