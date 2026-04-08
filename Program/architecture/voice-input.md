# 语音输入模块设计

> 用户通过语音驱动 Agent 操作，支持自配 ASR API，按键唤醒 + 悬浮窗按钮两种触发方式。

---

## 1. 需求概述

| 维度 | 内容 |
|------|------|
| **功能** | 语音 → 文本 → Agent 指令 |
| **触发方式** | 按键唤醒（按住说话）+ 悬浮窗按钮 |
| **处理方式** | 整段录完再处理（非流式） |
| **API 接入** | 用户自配 ASR API（Whisper / DeepGram / Azure 等） |
| **配置入口** | 设置页面，用户填入 API Key + Endpoint |

---

## 2. 系统架构

```
用户说话
   ↓
┌──────────────────┐
│   Audio Capture   │  麦克风录音，按键期间持续收音
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Audio Buffer     │  松开按键后，整段音频打包
└────────┬─────────┘
         ↓
┌──────────────────┐
│   ASR Adapter     │  统一抽象层，适配用户配置的 Provider
│  (Whisper/DeepGram│
│   /Azure/自定义)  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│   STT → Command   │  将文本转为 Agent 可执行的指令
│     Parser        │
└────────┬─────────┘
         ↓
┌──────────────────┐
│   Tool Dispatch   │  走现有 Tool Hooks 系统执行
└──────────────────┘
```

---

## 3. 核心模块

### 3.1 Audio Capture

- **触发**：按键按下开始，按键松开结束
- **实现**：WebRTC `MediaRecorder` 或平台原生 API
- **格式**：WebM / Opus（浏览器）或 PCM（Wails/原生）
- **状态**：Recording / Idle

### 3.2 ASR Adapter（统一抽象）

```typescript
interface ASRProvider {
  name: string;
  config: Record<string, string>;  // apiKey, endpoint, model 等
  transcribe(audioBlob: Blob): Promise<string>;
}
```

**内置适配器**：

| Provider | 说明 |
|----------|------|
| `openai-whisper` | OpenAI Whisper API |
| `deepgram` | DeepGram API |
| `azure-asr` | Azure Speech to Text |
| `custom` | 用户自填 REST URL + Auth 方式 |

**配置项**：

```yaml
voice:
  provider: "openai-whisper"  # 或 deepgram / azure / custom
  apiKey: "${OPENAI_API_KEY}"  # 支持环境变量
  endpoint: "https://api.openai.com/v1/audio/transcriptions"
  model: "whisper-1"
  language: "zh"  # 可选
```

### 3.3 Command Parser

将 ASR 输出文本解析为 Agent 指令：

```
"帮我把这个函数的注释改成中文" → { tool: "Edit", args: { ... } }
"运行一下测试"               → { tool: "Bash", args: { command: "npm test" } }
"解释这段代码"               → { tool: "解释", args: { ... } }  → Agent 自身处理
```

- **简单场景**：规则匹配 + 工具映射
- **复杂场景**：丢给 LLM 解析意图（再加一层 API 调用）
- **兜底**：无法解析时，将原文作为消息插入 REPL

### 3.4 触发方式

#### 按键唤醒

- **快捷键**：默认 `Ctrl + Shift + V`（全局热键）
- 按住开始录音，松开结束
- 需要**全局**捕获按键，不依赖前台窗口焦点
- **实现**：Tauri 的 `global_shortcut` 或 Electron 的 `globalShortcut`

#### 悬浮窗按钮

- 悬浮窗 Mini Widget 上有麦克风图标按钮
- 点击开始，再次点击结束（ toggle 模式）
- 适合不便使用键盘的场景

### 3.5 状态指示

| 状态 | UI 反馈 |
|------|---------|
| Idle | 麦克风图标 normal |
| Recording | 图标闪烁 / 边框变红 / 悬浮窗呼吸动画 |
| Processing | 转圈 + "识别中..." |
| Done | 结果 toast 或直接插入 REPL |
| Error | 错误提示 + 重试按钮 |

---

## 4. 配置入口

**设置页面（Settings）**：

```
语音输入
├── 启用语音输入  [开关]
├── ASR Provider [下拉: OpenAI / DeepGram / Azure / Custom]
├── API Key      [密码输入框，支持 env var 引用]
├── Endpoint     [文本框，provider 为 custom 时显示]
├── 语言         [下拉: 中文 / English / auto]
└── 按键设置
    ├── 启用按键唤醒  [开关]
    └── 快捷键       [快捷键录制器，默认 Ctrl+Shift+V]
```

---

## 5. 目录结构

```
Program/
├── agent/
│   └── src/
│       ├── voice/
│       │   ├── index.ts          # 导出入口
│       │   ├── audio-capture.ts  # 录音模块
│       │   ├── asr-adapter.ts     # ASR 抽象 + 内置适配器
│       │   ├── command-parser.ts # 语音→指令解析
│       │   └── hotkey.ts         # 全局热键注册
│       └── config/
│           └── voice-config.ts    # 配置读写
└── architecture/
    └── voice-input.md            # 本文档
```

---

## 6. 依赖关系

- **Phase 1（Agent）**：完成后才能接入 Tool Hooks
- **Phase 2（悬浮窗）**：悬浮窗按钮依赖 Mini Widget
- **Phase 2（全局热键）**：依赖 Tauri/Electron 的 global shortcut 能力

---

## 7. 待定问题

1. **Command Parser 的智能程度**：纯规则匹配 vs LLM 解析？LLM 解析有延迟和成本，但更准确。
2. **多轮对话支持**：当前设计是单次指令，是否需要支持"先...再..."类的多步语音指令？
3. **离线 ASR**：是否需要支持本地 Whisper 模型（无需 API）？
4. **打断机制**：Agent 执行过程中，用户是否可以语音打断？
