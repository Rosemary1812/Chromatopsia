import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Skill, SkillManifestEntry } from '../foundation/types.js';
import { parseSkillMarkdown, serializeSkillMarkdown } from './skill-parser.js';

const CHROMATOPSIA_DIR = '.chromatopsia';
const SKILLS_INDEX_FILE = 'index.json';
const SKILLS_DIR = 'skills';
const USER_DIR = 'user';
const DRAFTS_DIR = 'drafts';

interface SkillsIndex {
  version: number;
  updated_at: string;
  skills: SkillManifestEntry[];
}

interface SkillStoreOptions {
  indexPath?: string;
  runtimeSkillsRoot?: string;
  builtinSkillsRoots?: string[];
  enableBuiltin?: boolean;
  homeDir?: string;
  cwd?: string;
}

function normalizePath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

export class SkillStore {
  private skills = new Map<string, Skill>();
  private manifest = new Map<string, SkillManifestEntry>();
  private indexPath: string;
  private runtimeSkillsRoot: string;
  private builtinSkillsRoots: string[];
  private enableBuiltin: boolean;

  constructor(homeDirOrOptions?: string | SkillStoreOptions, cwd?: string) {
    if (typeof homeDirOrOptions === 'object' && homeDirOrOptions !== null) {
      const baseHome = homeDirOrOptions.homeDir ?? os.homedir();
      const baseCwd = homeDirOrOptions.cwd ?? process.cwd();
      this.runtimeSkillsRoot = homeDirOrOptions.runtimeSkillsRoot ?? path.join(baseHome, CHROMATOPSIA_DIR, SKILLS_DIR);
      this.indexPath = homeDirOrOptions.indexPath ?? path.join(this.runtimeSkillsRoot, SKILLS_INDEX_FILE);
      this.enableBuiltin = homeDirOrOptions.enableBuiltin ?? true;
      this.builtinSkillsRoots = homeDirOrOptions.builtinSkillsRoots ?? [
        path.join(baseCwd, 'skills', 'builtin'),
        path.join(baseCwd, 'packages', 'agent', 'skills', 'builtin'),
      ];
      return;
    }

    const baseHome = homeDirOrOptions ?? os.homedir();
    const baseCwd = cwd ?? process.cwd();
    this.indexPath = path.join(baseHome, CHROMATOPSIA_DIR, SKILLS_DIR, SKILLS_INDEX_FILE);
    this.runtimeSkillsRoot = path.join(baseHome, CHROMATOPSIA_DIR, SKILLS_DIR);
    this.enableBuiltin = homeDirOrOptions === undefined;
    this.builtinSkillsRoots = [
      path.join(baseCwd, 'skills', 'builtin'),
      path.join(baseCwd, 'packages', 'agent', 'skills', 'builtin'),
    ];
  }

  async load(): Promise<void> {
    this.skills.clear();
    this.manifest.clear();

    let index = await this.#readIndex();
    if (!index) {
      // fallback from legacy format to support existing users
      const migrated = await this.#tryLoadLegacySkillArray();
      if (migrated) {
        await this.#writeIndex();
      }
      index = await this.#readIndex();
    }

    if (index) {
      for (const entry of index.skills) {
        const loaded = await this.#loadSkillFromManifest(entry);
        if (loaded) {
          this.manifest.set(loaded.manifest.id, loaded.manifest);
          this.skills.set(loaded.skill.id, loaded.skill);
        }
      }
    }

    await this.#scanRuntimeDirectory(USER_DIR, 'user');
    await this.#scanRuntimeDirectory(DRAFTS_DIR, 'learning_draft');

    // Always merge builtin files if available
    if (this.enableBuiltin) {
      await this.#loadBuiltinSkills();
    }
    await this.#writeIndex();
  }

  async save(skill: Skill): Promise<void> {
    const existing = this.manifest.get(skill.id);
    const manifest: SkillManifestEntry = existing ?? {
      id: skill.id,
      name: skill.name,
      description: skill.trigger_condition,
      triggers: [skill.trigger_condition],
      trigger_pattern: skill.trigger_pattern,
      task_type: skill.task_type,
      scope: 'user',
      enabled: true,
      priority: 50,
      version: 1,
      updated_at: new Date(skill.updated_at || Date.now()).toISOString(),
      source_path: normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, USER_DIR, `${skill.id}.md`)),
    };

    manifest.name = skill.name;
    manifest.task_type = skill.task_type;
    manifest.trigger_pattern = skill.trigger_pattern;
    manifest.updated_at = new Date(skill.updated_at || Date.now()).toISOString();

    const absolutePath = await this.#resolveManifestPath(manifest.source_path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const markdown = serializeSkillMarkdown(manifest, skill);
    await fs.writeFile(absolutePath, markdown, 'utf-8');

    this.skills.set(skill.id, skill);
    this.manifest.set(skill.id, manifest);
    await this.#writeIndex();
  }

  async save_draft(skill: Skill): Promise<void> {
    const manifest: SkillManifestEntry = {
      id: skill.id,
      name: skill.name,
      description: skill.trigger_condition,
      triggers: [skill.trigger_condition],
      trigger_pattern: skill.trigger_pattern,
      task_type: skill.task_type,
      scope: 'learning_draft',
      enabled: false,
      priority: 10,
      version: 1,
      updated_at: new Date(skill.updated_at || Date.now()).toISOString(),
      source_path: normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, DRAFTS_DIR, `${skill.id}.md`)),
    };

    const absolutePath = await this.#resolveManifestPath(manifest.source_path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const markdown = serializeSkillMarkdown(manifest, skill);
    await fs.writeFile(absolutePath, markdown, 'utf-8');

    this.skills.set(skill.id, skill);
    this.manifest.set(skill.id, manifest);
    await this.#writeIndex();
  }

  list_drafts(): Skill[] {
    const out: Skill[] = [];
    for (const [id, skill] of this.skills.entries()) {
      const entry = this.manifest.get(id);
      if (entry?.scope === 'learning_draft') {
        out.push(skill);
      }
    }
    return out;
  }

  async approve_draft(id: string): Promise<Skill | null> {
    const skill = this.skills.get(id);
    const entry = this.manifest.get(id);
    if (!skill || !entry || entry.scope !== 'learning_draft') {
      return null;
    }

    await this.delete(id);
    await this.save({
      ...skill,
      updated_at: Date.now(),
    });
    return this.skills.get(id) ?? null;
  }

  async reject_draft(id: string): Promise<boolean> {
    const entry = this.manifest.get(id);
    if (!entry || entry.scope !== 'learning_draft') {
      return false;
    }
    await this.delete(id);
    return true;
  }

  async delete(id: string): Promise<void> {
    const entry = this.manifest.get(id);
    if (entry) {
      const absolutePath = await this.#resolveManifestPath(entry.source_path);
      try {
        await fs.unlink(absolutePath);
      } catch {
        // ignore missing files
      }
    }
    this.skills.delete(id);
    this.manifest.delete(id);
    await this.#writeIndex();
  }

  getAll(): Skill[] {
    return [...this.skills.values()];
  }

  getManifest(): SkillManifestEntry[] {
    return [...this.manifest.values()].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.name.localeCompare(b.name);
    });
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

  async #loadBuiltinSkills(): Promise<void> {
    for (const root of this.builtinSkillsRoots) {
      let files: string[] = [];
      try {
        files = await fs.readdir(root);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.toLowerCase().endsWith('.md')) continue;
        const fullPath = path.join(root, file);
        const raw = await fs.readFile(fullPath, 'utf-8');
        const isWorkspaceBuiltin = normalizePath(root).includes('packages/agent/skills/builtin');
        const sourcePath = isWorkspaceBuiltin
          ? normalizePath(path.join('packages', 'agent', 'skills', 'builtin', file))
          : normalizePath(path.join('skills', 'builtin', file));
        const parsed = parseSkillMarkdown(raw, sourcePath);
        if (!parsed) continue;
        parsed.manifest.scope = 'builtin';
        parsed.manifest.source_path = sourcePath;
        this.manifest.set(parsed.manifest.id, parsed.manifest);
        this.skills.set(parsed.skill.id, parsed.skill);
      }
      return;
    }
  }

  async #scanRuntimeDirectory(subdir: typeof USER_DIR | typeof DRAFTS_DIR, scope: SkillManifestEntry['scope']): Promise<void> {
    const root = path.join(this.runtimeSkillsRoot, subdir);
    let files: string[] = [];
    try {
      files = await fs.readdir(root);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.md')) continue;
      const fullPath = path.join(root, file);
      const sourcePath = normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, subdir, file));
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseSkillMarkdown(raw, sourcePath);
      if (!parsed) continue;
      parsed.manifest.scope = scope;
      parsed.manifest.source_path = sourcePath;
      this.manifest.set(parsed.manifest.id, parsed.manifest);
      this.skills.set(parsed.skill.id, parsed.skill);
    }
  }

  async #readIndex(): Promise<SkillsIndex | null> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as SkillsIndex;
      if (!parsed || !Array.isArray(parsed.skills)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async #loadSkillFromManifest(entry: SkillManifestEntry): Promise<{ manifest: SkillManifestEntry; skill: Skill } | null> {
    const fullPath = await this.#resolveManifestPath(entry.source_path);
    try {
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseSkillMarkdown(raw, entry.source_path);
      if (!parsed) return null;
      parsed.manifest.scope = entry.scope;
      return { manifest: parsed.manifest, skill: parsed.skill };
    } catch {
      return null;
    }
  }

  async #resolveManifestPath(sourcePath: string): Promise<string> {
    const normalized = normalizePath(sourcePath);
    if (normalized.startsWith('skills/builtin/') || normalized.startsWith('packages/agent/skills/builtin/')) {
      const basename = path.basename(normalized);
      const candidates = [
        ...this.builtinSkillsRoots.map((root) => path.join(root, basename)),
        path.join(process.cwd(), normalized),
      ];
      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // try next candidate
        }
      }
      return candidates[0];
    }
    const relative = normalized.startsWith(`${CHROMATOPSIA_DIR}/`)
      ? normalized.slice(CHROMATOPSIA_DIR.length + 1)
      : normalized;
    const storageRoot = path.dirname(this.runtimeSkillsRoot);
    return path.join(storageRoot, relative);
  }

  async #writeIndex(): Promise<void> {
    const dir = path.dirname(this.indexPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(this.runtimeSkillsRoot, USER_DIR), { recursive: true });
    await fs.mkdir(path.join(this.runtimeSkillsRoot, DRAFTS_DIR), { recursive: true });
    const payload: SkillsIndex = {
      version: 1,
      updated_at: new Date().toISOString(),
      skills: this.getManifest(),
    };
    await fs.writeFile(this.indexPath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  async #tryLoadLegacySkillArray(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const arr = JSON.parse(raw) as Skill[];
      if (!Array.isArray(arr)) {
        return false;
      }
      let migrated = false;
      for (const skill of arr) {
        if (!skill || typeof skill.id !== 'string') continue;
        const manifest: SkillManifestEntry = {
          id: skill.id,
          name: skill.name,
          description: skill.trigger_condition,
          triggers: [skill.trigger_condition],
          trigger_pattern: skill.trigger_pattern,
          task_type: skill.task_type,
          scope: 'user',
          enabled: true,
          priority: 50,
          version: 1,
          updated_at: new Date(skill.updated_at || Date.now()).toISOString(),
          source_path: normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, USER_DIR, `${skill.id}.md`)),
        };
        this.manifest.set(skill.id, manifest);
        this.skills.set(skill.id, skill);
        await this.save(skill);
        migrated = true;
      }
      return migrated;
    } catch {
      return false;
    }
  }
}
