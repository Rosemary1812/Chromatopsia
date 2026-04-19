/**
 * Session Manager — 会话生命周期管理
 * T-17
 *
 * 职责：
 * - Session 创建 / 获取 / 删除
 * - 通过 SessionHistory 持久化消息
 * - recover_or_prompt 三段式恢复逻辑
 * - 协调 compact 压缩逻辑
 */

import { createHash } from 'crypto';
import type {
  Session,
  Message,
  ProjectContext,
  UserContext,
  CompressionMetadata,
  LLMProvider,
} from '../foundation/types.js';
import { SessionHistory } from './history.js';
import {
  compress_session,
  DEFAULT_COMPRESSION_CONFIG,
} from './summarizer.js';
import {
  estimateContextTokens,
  calculateContextFillRate,
  getContextWindowSize,
} from '../foundation/llm/token-counter.js';

/**
 * Session 实现 — 实现 Session 接口
 * 持有内存中的 messages 列表和元数据
 */
class SessionImpl implements Session {
  id: string;
  messages: Message[] = [];
  working_directory: string;
  project_context?: ProjectContext;
  user_context?: UserContext;
  created_at: number;
  last_active: number;

  /** 临时属性，存储最近一次压缩元数据 */
  last_compact_metadata?: CompressionMetadata;

  private manager: SessionManager;

  constructor(
    id: string,
    working_directory: string,
    project_context: ProjectContext | undefined,
    manager: SessionManager,
  ) {
    this.id = id;
    this.working_directory = working_directory;
    this.project_context = project_context;
    this.created_at = Date.now();
    this.last_active = this.created_at;
    this.manager = manager;
  }

  add_message(message: Message): void {
    this.messages.push(message);
    this.last_active = Date.now();
    this.manager.persist_message(this.id, message);
  }

  clear(): void {
    this.messages = [];
    this.last_active = Date.now();
    this.manager.replace_messages(this.id, this.messages);
  }

  compact(): Promise<void> {
    return this.manager.truncate_history(this.id);
  }

  /**
   * 获取当前 session 的 token 使用统计
   * @param model - LLM 模型名称（用于确定 context window 大小）
   * @returns 包含当前 tokens、阈值、剩余、百分比和警告标志的对象
   */
  getTokenStats(model: string): {
    current: number;
    max: number;
    remaining: number;
    percentage: number;
    warn: boolean;
  } {
    const current = estimateContextTokens(this.messages);
    const max = getContextWindowSize(model);
    const remaining = max - current;
    const percentage = Math.round((current / max) * 100);
    const warn = percentage >= 80; // 80% 以上警告

    return {
      current,
      max,
      remaining,
      percentage,
      warn,
    };
  }

  /**
   * 判断是否应该压缩（基于上下文填充率）
   * @param model - LLM 模型名称
   * @param threshold - 填充率阈值（默认 0.8 = 80%）
   * @returns true 表示应该压缩
   */
  should_compact_with_model(model: string, threshold: number = 0.8): boolean {
    const fillRate = calculateContextFillRate(this.messages, model);
    return fillRate > threshold;
  }
}

/**
 * SessionManager — 管理所有活跃 Session
 */
export class SessionManager {
  private sessions = new Map<string, SessionImpl>();
  private history: SessionHistory;
  private provider: LLMProvider;

  constructor(history_dir: string, provider: LLMProvider) {
    this.history = new SessionHistory(history_dir);
    this.provider = provider;
  }

  /**
   * 生成唯一 session ID
   * 格式：{working_dir_hash_8chars}-{timestamp_36}
   */
  generate_session_id(working_directory: string): string {
    const hash = createHash('sha1')
      .update(working_directory)
      .digest('hex')
      .slice(0, 8);
    const random = Math.random().toString(36).slice(2, 6);
    return `${hash}-${random}-${Date.now().toString(36)}`;
  }

  /**
   * 创建新 Session
   */
  create_session(
    working_directory: string,
    project_context?: ProjectContext,
  ): Session {
    const id = this.generate_session_id(working_directory);
    const session = new SessionImpl(id, working_directory, project_context, this);
    this.sessions.set(id, session);
    // Await to ensure the session is persisted before returning
    // so subsequent add_message calls find the session already registered
    this.history.create_session(id, working_directory);
    return session;
  }

  /**
   * 获取 Session
   */
  get_session(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * 获取指定 session 的消息列表（供 LLM 使用）
   */
  get_messages_for_llm(id: string): Message[] {
    const session = this.sessions.get(id);
    return session ? session.messages : [];
  }

  /**
   * 追加消息并持久化（同步）
   * 仅由 SessionImpl.add_message 调用
   */
  persist_message(session_id: string, message: Message): void {
    const session = this.sessions.get(session_id);
    if (!session) return;
    this.history.append_message_sync(session_id, message);
  }

  replace_messages(session_id: string, messages: Message[]): void {
    const session = this.sessions.get(session_id);
    if (!session) return;
    this.history.rewrite_session_sync(session_id, messages);
  }

  /**
   * 压缩 session 消息历史
   * 异步方法，调用 compress_session 走 LLM 摘要决策树：
   * 1. 优先 LLM 摘要
   * 2. LLM 失败 → 降级截断
   * 3. 消息太少（< min_summarizable）→ 直接截断
   */
  async truncate_history(session_id: string): Promise<void> {
    const session = this.sessions.get(session_id);
    if (!session) return;

    const result = await compress_session(
      session.messages,
      DEFAULT_COMPRESSION_CONFIG,
      this.provider,
    );

    session.messages = result.compressed;
    session.last_compact_metadata = result.metadata;
    this.history.rewrite_session_sync(session_id, session.messages);
  }

  /**
   * Session 恢复逻辑
   *
   * 三种情况：
   * 1. 无活跃 session → 创建新 session
   * 2. 一个活跃 session → 自动恢复
   * 3. 多个活跃 session → 返回候选列表
   *
   * @param working_directory 当前工作目录
   * @returns 恢复结果
   */
  async recover_or_prompt(
    working_directory: string,
  ): Promise<
    | { recovered: false; session: Session }
    | { recovered: true; session: Session }
    | { candidates: Array<{ session_id: string; working_directory: string; created_at: number; last_active: number; message_count: number }> }
  > {
    const active = (await this.history.list_sessions()).filter(
      (s) => s.working_directory === working_directory && !s.archived,
    );

    if (active.length === 0) {
      const session = this.create_session(working_directory);
      return { recovered: false, session };
    }

    if (active.length === 1) {
      const entry = active[0];
      const messages = await this.history.load_session(entry.session_id);
      const session = new SessionImpl(
        entry.session_id,
        entry.working_directory,
        undefined,
        this,
      );
      session.messages = messages;
      session.last_active = entry.last_active;
      this.sessions.set(entry.session_id, session);
      return { recovered: true, session };
    }

    // 多个候选
    return {
      candidates: active.map((s) => ({
        session_id: s.session_id,
        working_directory: s.working_directory,
        created_at: s.created_at,
        last_active: s.last_active,
        message_count: s.message_count,
      })),
    };
  }

  /**
   * 列出所有活跃 session
   */
  async list_active_sessions(): Promise<
    Array<{
      id: string;
      working_directory: string;
      created_at: number;
      last_active: number;
      message_count: number;
    }>
  > {
    const entries = await this.history.list_sessions();
    return entries.map((e) => ({
      id: e.session_id,
      working_directory: e.working_directory,
      created_at: e.created_at,
      last_active: e.last_active,
      message_count: e.message_count,
    }));
  }

  /**
   * 删除 session（从内存移除，归档历史）
   */
  async archive_session(session_id: string): Promise<void> {
    this.sessions.delete(session_id);
    await this.history.archive_session(session_id);
  }

  get_history(): SessionHistory {
    return this.history;
  }
}
