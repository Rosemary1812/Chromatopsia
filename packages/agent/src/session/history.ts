// Placeholder - to be implemented in Phase 3
import type { Message } from '../types.js';

export class SessionHistory {
  async list_sessions() { throw new Error('Not implemented yet'); }
  async load_session(_session_id: string): Promise<Message[]> { throw new Error('Not implemented yet'); }
  async append_message(_session_id: string, _message: Message): Promise<void> { throw new Error('Not implemented yet'); }
  async archive_session(_session_id: string): Promise<void> { throw new Error('Not implemented yet'); }
}
