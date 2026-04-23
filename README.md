![Chromatopsia Banner](https://raw.githubusercontent.com/Rosemary1812/Chromatopsia/main/.github/assets/banner.png)
# Chromatopsia
Chromatopsia 是一个面向终端的 coding agent 项目，目标是在本地开发环境中提供接近真实工程协作的代理式编程体验。

当前仓库已经具备：

- agent runtime 与事件通信层
- TUI
- 文件、搜索、命令、网页等开发工具
- 审批、摘要、记忆、技能和学习机制的基础框架
- 整体仍在快速迭代中，但主流程已经可以用于本地实验和持续开发。

## TUI展示
![Chromatopsia Terminal](https://raw.githubusercontent.com/Rosemary1812/Chromatopsia/main/.github/assets/tui.png)

## 功能

### 交互体验
- **交互式 TUI**：REPL 主循环，支持流式 Markdown 渲染、实时 token 回显
- **斜杠命令（`/`）**：动态匹配 Skill 命令，按需加载 Markdown guidance，而不是执行宏步骤
- **会话记忆**：SessionManager 管理会话生命周期，支持创建、恢复、归档

### Agent 核心
- **工具调用循环**：LLM → Tool 串行/并行混合执行回路
- **内置 8 个工具**：run_shell、read_file、write_file、edit_file、list_files、grep、glob、web_search、web_fetch
- **多后端支持**：OpenAI 兼容 API 和 Anthropic Messages API，可配置自定义 base_url

### 安全与隔离
- **文件工具沙箱化**：路径解析约束在工作区内，阻止路径遍历
- **Shell 命令防御**：~ 展开 + 危险模式检测 + 命令白名单化
- **工具审批钩子**：warning / dangerous 工具支持运行时审批

### 会话管理
- **会话隔离与恢复**：三段式恢复逻辑（无活跃 → 自动恢复 → 多候选选择）
- **长对话自动压缩**：长对话自动触发 LLM 摘要压缩，保持上下文精简
- **跨会话持久化**：SessionHistory 消息落盘，重启后自动恢复

### 自学习机制（实验功能）
- **TurnEvent 采集**：每次对话轮次结束后，自动记录输入、输出、工具调用等关键事件
- **Learning Worker**：定期对采集的事件进行离线合成与分析，从历史行为中提炼共性模式
- **Skill 自动生成**：基于合成结果生成完整 `SKILL.md` guidance，经人类审批后注册为正式 Skill

### 配置与诊断
- 首次启动自动进入 onboarding，完成 provider、model、base_url、API key 和主题配置
- `chroma config path`：定位当前配置文件路径
- `chroma doctor`：检查本地运行环境

## 安装

```bash
npm install -g chromatopsia
```

安装后命令为：

```bash
chroma
```

## 首次启动

- 没有现有配置时，运行 `chroma` 会自动进入 onboarding
- onboarding 中可配置 provider、model、`base_url`、API key、TUI theme
- 配置生成后，再次启动会直接进入 TUI

## 常用命令

```bash
chroma
chroma config path
chroma doctor
```

## 配置说明

- `chroma config path`：查看当前配置文件路径
- `chroma doctor`：检查本地运行环境
- 如果你使用 OpenAI 兼容上游或代理服务，请在 onboarding 中填写自定义 `base_url`
