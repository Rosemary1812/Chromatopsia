import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { TurnEvent } from '../foundation/types.js';

interface LearningState {
  per_session_turns: Record<string, number>;
}

const CHROMATOPSIA_DIR = '.chromatopsia';
const LEARNING_DIR = 'learning';
const EVENTS_FILE = 'turn-events.jsonl';
const STATE_FILE = 'state.json';

export class TurnEventStore {
  private baseDir: string;
  private eventsPath: string;
  private statePath: string;

  constructor(homeDir?: string) {
    const baseHome = homeDir ?? os.homedir();
    this.baseDir = path.join(baseHome, CHROMATOPSIA_DIR, LEARNING_DIR);
    this.eventsPath = path.join(this.baseDir, EVENTS_FILE);
    this.statePath = path.join(this.baseDir, STATE_FILE);
  }

  async append(event: TurnEvent): Promise<void> {
    await this.ensureDir();
    await fs.appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf-8');
  }

  /**
   * Retrieve recent events for a session using reverse streaming.
   * Reads from the end of the file backwards to avoid loading the entire file into memory.
   */
  async recentBySession(sessionId: string, limit: number): Promise<TurnEvent[]> {
    await this.ensureDir();
    try {
      const stats = await fs.stat(this.eventsPath);
      if (stats.size === 0) return [];
    } catch {
      return [];
    }

    const out: TurnEvent[] = [];
    const bufferSize = Math.max(8192, Math.min(65536, limit * 256)); // Adaptive buffer
    const buffer = Buffer.alloc(bufferSize);
    let position = (await fs.stat(this.eventsPath)).size;
    let leftover = '';

    // Read file backwards in chunks
    while (position > 0 && out.length < limit) {
      const bytesToRead = Math.min(bufferSize, position);
      position -= bytesToRead;

      const fd = await fs.open(this.eventsPath, 'r');
      try {
        const { bytesRead } = await fd.read(buffer, 0, bytesToRead, position);
        const chunk = buffer.toString('utf-8', 0, bytesRead);
        const combined = chunk + leftover;

        // Split by newlines and process in reverse (skip the last incomplete line)
        const lines = combined.split('\n');
        leftover = lines[0]; // Save the incomplete line for next iteration

        // Process lines in reverse order, skipping the last one
        for (let i = lines.length - 1; i > 0; i--) {
          const line = lines[i].trim();
          if (!line) continue;
          try {
            const parsed = JSON.parse(line) as TurnEvent;
            if (parsed.session_id === sessionId) {
              out.push(parsed);
              if (out.length >= limit) break;
            }
          } catch {
            // Skip malformed lines
          }
        }
      } finally {
        await fd.close();
      }
    }

    // Handle leftover line if we haven't reached the limit
    if (out.length < limit && leftover.trim()) {
      try {
        const parsed = JSON.parse(leftover.trim()) as TurnEvent;
        if (parsed.session_id === sessionId) {
          out.push(parsed);
        }
      } catch {
        // Skip malformed line
      }
    }

    return out.reverse();
  }

  async incrementSessionTurns(sessionId: string): Promise<number> {
    const state = await this.readState();
    const current = state.per_session_turns[sessionId] ?? 0;
    const next = current + 1;
    state.per_session_turns[sessionId] = next;
    await this.writeState(state);
    return next;
  }

  async resetSessionTurns(sessionId: string): Promise<void> {
    const state = await this.readState();
    state.per_session_turns[sessionId] = 0;
    await this.writeState(state);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  private async readState(): Promise<LearningState> {
    await this.ensureDir();
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as LearningState;
      if (!parsed.per_session_turns) {
        return { per_session_turns: {} };
      }
      return parsed;
    } catch {
      return { per_session_turns: {} };
    }
  }

  private async writeState(state: LearningState): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }
}

