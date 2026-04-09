import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Skill } from '../types';

const CHROMATOPSIA_DIR = '.chromatopsia';
const SKILLS_FILE = 'skills.json';

export class SkillStore {
  private skills = new Map<string, Skill>();
  private storagePath: string;

  constructor(homeDir?: string) {
    const baseDir = homeDir ?? os.homedir();
    this.storagePath = path.join(baseDir, CHROMATOPSIA_DIR, SKILLS_FILE);
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf-8');
      const arr: Skill[] = JSON.parse(raw);
      this.skills.clear();
      for (const s of arr) {
        this.skills.set(s.id, s);
      }
    } catch (err) {
      // File doesn't exist or is malformed — start with empty store
      this.skills.clear();
    }
  }

  async save(skill: Skill): Promise<void> {
    this.skills.set(skill.id, skill);
    await this.#writeToDisk();
  }

  async delete(id: string): Promise<void> {
    this.skills.delete(id);
    await this.#writeToDisk();
  }

  getAll(): Skill[] {
    return [...this.skills.values()];
  }

  byTaskType(task_type: string): Skill[] {
    return [...this.skills.values()].filter((s) => s.task_type === task_type);
  }

  fuzzySearch(query: string): Skill[] {
    const q = query.toLowerCase();
    return [...this.skills.values()].filter(
      (s) =>
        s.task_type.toLowerCase().includes(q) ||
        s.trigger_condition.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q),
    );
  }

  async #writeToDisk(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.storagePath,
      JSON.stringify([...this.skills.values()], null, 2),
      'utf-8',
    );
  }
}
