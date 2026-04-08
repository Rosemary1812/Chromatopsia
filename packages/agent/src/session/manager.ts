// Placeholder - to be implemented in Phase 3
import type { Session } from '../types.js';

export class SessionManager {
  create_session(_working_directory: string): Session {
    throw new Error('Not implemented yet');
  }

  get_session(_id: string): Session | undefined {
    throw new Error('Not implemented yet');
  }
}
