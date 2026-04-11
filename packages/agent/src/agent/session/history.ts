import { readFile, writeFile } from 'fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Message } from '../../foundation/types.js';

const SESSION_INDEX_NAME = 'index.json';

export interface SessionIndexEntry {
  session_id: string;
  working_directory: string;
  created_at: number;
  last_active: number;
  message_count: number;
  archived?: boolean;
}

export interface SessionIndex {
  sessions: SessionIndexEntry[];
}

export class SessionHistory {
  private base_dir: string;

  constructor(base_dir: string) {
    this.base_dir = base_dir;
  }

  private ensure_dir(): void {
    mkdirSync(this.base_dir, { recursive: true });
  }

  private index_path(): string {
    return join(this.base_dir, SESSION_INDEX_NAME);
  }

  private session_path(session_id: string): string {
    return join(this.base_dir, `${session_id}.jsonl`);
  }

  // Synchronous index read
  private read_index_sync(): SessionIndex {
    try {
      const raw = readFileSync(this.index_path(), 'utf-8');
      return JSON.parse(raw) as SessionIndex;
    } catch {
      return { sessions: [] };
    }
  }

  // Synchronous index write
  private write_index_sync(index: SessionIndex): void {
    writeFileSync(this.index_path(), JSON.stringify(index, null, 2), 'utf-8');
  }

  async list_sessions(): Promise<SessionIndexEntry[]> {
    this.ensure_dir();
    const index = this.read_index_sync();
    return index.sessions.filter((e) => !e.archived);
  }

  async load_session(session_id: string): Promise<Message[]> {
    this.ensure_dir();
    const path = this.session_path(session_id);
    try {
      const raw = await readFile(path, 'utf-8');
      const lines = raw.split('\n').filter((line) => line.trim() !== '');
      const messages: Message[] = [];
      for (const line of lines) {
        try {
          messages.push(JSON.parse(line) as Message);
        } catch {
          // skip corrupted lines
        }
      }
      return messages;
    } catch {
      return [];
    }
  }

  /**
   * Synchronous version of append_message.
   * Uses writeFileSync for both the index and the JSONL file.
   * This is called by SessionManager which needs synchronous guarantees.
   */
  append_message_sync(session_id: string, message: Message): void {
    this.ensure_dir();
    const path = this.session_path(session_id);

    const index = this.read_index_sync();
    const entry_idx = index.sessions.findIndex((e) => e.session_id === session_id);

    if (entry_idx === -1) {
      // Session entry doesn't exist — create it
      index.sessions.push({
        session_id,
        working_directory: '',
        created_at: Date.now(),
        last_active: Date.now(),
        message_count: 1,
      });
    } else {
      // Update existing entry
      index.sessions[entry_idx] = {
        ...index.sessions[entry_idx],
        last_active: Date.now(),
        message_count: index.sessions[entry_idx].message_count + 1,
      };
    }
    this.write_index_sync(index);

    // Append message line to JSONL
    const line = JSON.stringify(message) + '\n';
    writeFileSync(path, line, { encoding: 'utf-8', flag: 'a' });
  }

  /**
   * Async version of append_message — for callers that need async.
   */
  async append_message(session_id: string, message: Message): Promise<void> {
    this.ensure_dir();
    const path = this.session_path(session_id);

    const index = this.read_index_sync();
    const entry_idx = index.sessions.findIndex((e) => e.session_id === session_id);

    if (entry_idx === -1) {
      index.sessions.push({
        session_id,
        working_directory: '',
        created_at: Date.now(),
        last_active: Date.now(),
        message_count: 1,
      });
    } else {
      index.sessions[entry_idx] = {
        ...index.sessions[entry_idx],
        last_active: Date.now(),
        message_count: index.sessions[entry_idx].message_count + 1,
      };
    }
    this.write_index_sync(index);

    const line = JSON.stringify(message) + '\n';
    await writeFile(path, line, { encoding: 'utf-8', flag: 'a' });
  }

  archive_session(session_id: string): void {
    const index = this.read_index_sync();
    const idx = index.sessions.findIndex((e) => e.session_id === session_id);
    if (idx === -1) return;
    index.sessions[idx] = { ...index.sessions[idx], archived: true };
    this.write_index_sync(index);
  }

  /**
   * Synchronous session creation — called by SessionManager.
   */
  create_session(session_id: string, working_directory: string): void {
    this.ensure_dir();
    const index = this.read_index_sync();
    const existing_idx = index.sessions.findIndex((e) => e.session_id === session_id);
    const new_entry: SessionIndexEntry = {
      session_id,
      working_directory,
      created_at: Date.now(),
      last_active: Date.now(),
      message_count: 0,
    };
    if (existing_idx !== -1) {
      index.sessions[existing_idx] = new_entry;
    } else {
      index.sessions.push(new_entry);
    }
    this.write_index_sync(index);
  }
}
