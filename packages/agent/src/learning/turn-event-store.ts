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

  async recentBySession(sessionId: string, limit: number): Promise<TurnEvent[]> {
    await this.ensureDir();
    let raw = '';
    try {
      raw = await fs.readFile(this.eventsPath, 'utf-8');
    } catch {
      return [];
    }

    const out: TurnEvent[] = [];
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as TurnEvent;
        if (parsed.session_id === sessionId) {
          out.push(parsed);
          if (out.length >= limit) break;
        }
      } catch {
        // skip malformed lines
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

