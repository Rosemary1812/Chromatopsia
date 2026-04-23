import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Skill, SkillDocument, SkillManifestEntry } from '../foundation/types.js';
import { parseSkillMarkdown, serializeSkillMarkdown } from './skill-parser.js';

const CHROMATOPSIA_DIR = '.chromatopsia';
const SKILLS_INDEX_FILE = 'index.json';
const SKILLS_DIR = 'skills';
const USER_DIR = 'user';
const DRAFTS_DIR = 'drafts';
const SKILL_MD = 'SKILL.md';

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

function sourcePathForRuntime(subdir: typeof USER_DIR | typeof DRAFTS_DIR, entryName: string, isDirectory: boolean): string {
  return normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, subdir, isDirectory ? path.join(entryName, SKILL_MD) : entryName));
}

export class SkillStore {
  private skills = new Map<string, Skill>();
  private manifest = new Map<string, SkillManifestEntry>();
  private documents = new Map<string, SkillDocument>();
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
    this.documents.clear();

    let index = await this.#readIndex();
    if (!index) {
      const migrated = await this.#tryLoadLegacySkillArray();
      if (migrated) await this.#writeIndex();
      index = await this.#readIndex();
    }

    if (index) {
      for (const entry of index.skills) {
        const loaded = await this.#loadDocumentFromManifest(entry);
        if (loaded) this.#registerDocument(loaded);
      }
    }

    await this.#scanRuntimeDirectory(USER_DIR, 'user');
    await this.#scanRuntimeDirectory(DRAFTS_DIR, 'learning_draft');

    if (this.enableBuiltin) {
      await this.#loadBuiltinSkills();
    }
    await this.#writeIndex();
  }

  async save(skill: Skill): Promise<void> {
    const existing = this.manifest.get(skill.id);
    const sourcePath = existing?.sourcePath ?? normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, USER_DIR, skill.id, SKILL_MD));
    const manifest: SkillManifestEntry = {
      id: skill.id,
      name: skill.name,
      description: skill.trigger_condition,
      userInvocable: existing?.userInvocable ?? true,
      context: existing?.context ?? 'inline',
      agent: existing?.agent,
      paths: existing?.paths ?? [],
      triggers: existing?.triggers ?? [skill.trigger_condition],
      trigger_pattern: skill.trigger_pattern,
      task_type: skill.task_type,
      scope: 'user',
      enabled: true,
      priority: existing?.priority ?? 50,
      version: existing?.version ?? 1,
      updated_at: new Date(skill.updated_at || Date.now()).toISOString(),
      sourcePath,
      source_path: sourcePath,
    };

    const absolutePath = await this.#resolveManifestPath(manifest.source_path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const body = this.documents.get(skill.id)?.body;
    const markdown = serializeSkillMarkdown(manifest, body ?? skill);
    await fs.writeFile(absolutePath, markdown, 'utf-8');

    const parsed = parseSkillMarkdown(markdown, manifest.source_path);
    if (parsed) this.#registerDocument({ ...parsed, manifest });
    await this.#writeIndex();
  }

  async save_draft(skillOrDocument: Skill | SkillDocument | string): Promise<void> {
    let document: SkillDocument;
    if (typeof skillOrDocument === 'string') {
      const sourcePath = normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, DRAFTS_DIR, 'draft', SKILL_MD));
      const parsed = parseSkillMarkdown(skillOrDocument, sourcePath);
      if (!parsed) throw new Error('Invalid SKILL.md draft');
      document = parsed;
    } else if ('body' in skillOrDocument && 'manifest' in skillOrDocument) {
      document = skillOrDocument;
    } else {
      const skill = skillOrDocument;
      const sourcePath = normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, DRAFTS_DIR, skill.id, SKILL_MD));
      const manifest: SkillManifestEntry = {
        id: skill.id,
        name: skill.name,
        description: skill.trigger_condition,
        userInvocable: true,
        context: 'inline',
        paths: [],
        triggers: [skill.trigger_condition],
        trigger_pattern: skill.trigger_pattern,
        task_type: skill.task_type,
        scope: 'learning_draft',
        enabled: false,
        priority: 10,
        version: 1,
        updated_at: new Date(skill.updated_at || Date.now()).toISOString(),
        sourcePath,
        source_path: sourcePath,
      };
      const raw = serializeSkillMarkdown(manifest, skill);
      const parsed = parseSkillMarkdown(raw, sourcePath);
      if (!parsed) throw new Error('Invalid generated draft');
      document = parsed;
    }

    document.manifest.scope = 'learning_draft';
    document.manifest.enabled = false;
    document.manifest.priority = Math.min(document.manifest.priority, 10);
    const sourcePath = normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, DRAFTS_DIR, document.manifest.id, SKILL_MD));
    document.manifest.sourcePath = sourcePath;
    document.manifest.source_path = sourcePath;

    const markdown = serializeSkillMarkdown(document.manifest, document.body);
    const absolutePath = await this.#resolveManifestPath(sourcePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, markdown, 'utf-8');
    this.#registerDocument({ ...document, raw: markdown });
    await this.#writeIndex();
  }

  list_drafts(): Skill[] {
    return [...this.skills.entries()]
      .filter(([id]) => this.manifest.get(id)?.scope === 'learning_draft')
      .map(([, skill]) => skill);
  }

  async approve_draft(id: string): Promise<Skill | null> {
    const document = this.documents.get(id);
    const entry = this.manifest.get(id);
    if (!document || !entry || entry.scope !== 'learning_draft') return null;

    await this.delete(id);
    const sourcePath = normalizePath(path.join(CHROMATOPSIA_DIR, SKILLS_DIR, USER_DIR, id, SKILL_MD));
    const manifest: SkillManifestEntry = {
      ...document.manifest,
      scope: 'user',
      enabled: true,
      priority: Math.max(document.manifest.priority, 50),
      updated_at: new Date().toISOString(),
      sourcePath,
      source_path: sourcePath,
    };
    const markdown = serializeSkillMarkdown(manifest, document.body);
    const absolutePath = await this.#resolveManifestPath(sourcePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, markdown, 'utf-8');
    const parsed = parseSkillMarkdown(markdown, sourcePath);
    if (parsed) this.#registerDocument({ ...parsed, manifest });
    await this.#writeIndex();
    return this.skills.get(id) ?? null;
  }

  async reject_draft(id: string): Promise<boolean> {
    const entry = this.manifest.get(id);
    if (!entry || entry.scope !== 'learning_draft') return false;
    await this.delete(id);
    return true;
  }

  async delete(id: string): Promise<void> {
    const entry = this.manifest.get(id);
    if (entry) {
      const absolutePath = await this.#resolveManifestPath(entry.sourcePath ?? entry.source_path);
      try {
        await fs.unlink(absolutePath);
      } catch {
        // ignore missing files
      }
    }
    this.skills.delete(id);
    this.manifest.delete(id);
    this.documents.delete(id);
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

  getDocumentByName(name: string): SkillDocument | null {
    const q = name.toLowerCase();
    for (const document of this.documents.values()) {
      if (document.manifest.name.toLowerCase() === q || document.manifest.id.toLowerCase() === q) {
        return document;
      }
    }
    return null;
  }

  async loadDocument(name: string): Promise<SkillDocument | null> {
    const cached = this.getDocumentByName(name);
    if (cached) return cached;
    const entry = this.getManifest().find((item) => item.name === name || item.id === name);
    if (!entry) return null;
    const loaded = await this.#loadDocumentFromManifest(entry);
    if (!loaded) return null;
    this.#registerDocument(loaded);
    return loaded;
  }

  byTaskType(task_type: string): Skill[] {
    return [...this.skills.values()].filter((s) => s.task_type === task_type);
  }

  fuzzySearch(query: string): Skill[] {
    const q = query.toLowerCase();
    return [...this.skills.values()].filter(
      (s) => s.task_type.toLowerCase().includes(q) || s.trigger_condition.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
  }

  async #loadBuiltinSkills(): Promise<void> {
    for (const root of this.builtinSkillsRoots) {
      let entries: import('fs').Dirent[] = [];
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const loaded = await this.#loadSkillEntry(root, entry, 'builtin');
        if (!loaded) continue;
        const sourcePrefix = normalizePath(root).includes('packages/agent/skills/builtin')
          ? normalizePath(path.join('packages', 'agent', 'skills', 'builtin'))
          : normalizePath(path.join('skills', 'builtin'));
        const relative = entry.isDirectory() ? path.join(entry.name, SKILL_MD) : entry.name;
        loaded.manifest.scope = 'builtin';
        loaded.manifest.sourcePath = normalizePath(path.join(sourcePrefix, relative));
        loaded.manifest.source_path = loaded.manifest.sourcePath;
        this.#registerDocument(loaded);
      }
      return;
    }
  }

  async #scanRuntimeDirectory(subdir: typeof USER_DIR | typeof DRAFTS_DIR, scope: SkillManifestEntry['scope']): Promise<void> {
    const root = path.join(this.runtimeSkillsRoot, subdir);
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const loaded = await this.#loadSkillEntry(root, entry, scope);
      if (!loaded) continue;
      loaded.manifest.scope = scope;
      loaded.manifest.sourcePath = sourcePathForRuntime(subdir, entry.name, entry.isDirectory());
      loaded.manifest.source_path = loaded.manifest.sourcePath;
      this.#registerDocument(loaded);
    }
  }

  async #loadSkillEntry(root: string, entry: import('fs').Dirent, scope: SkillManifestEntry['scope']): Promise<SkillDocument & { skill: Skill } | null> {
    let fullPath: string;
    let sourcePath: string;
    if (entry.isDirectory()) {
      fullPath = path.join(root, entry.name, SKILL_MD);
      sourcePath = normalizePath(path.join(root, entry.name, SKILL_MD));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      fullPath = path.join(root, entry.name);
      sourcePath = normalizePath(path.join(root, entry.name));
    } else {
      return null;
    }

    try {
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseSkillMarkdown(raw, sourcePath);
      if (!parsed) return null;
      parsed.manifest.scope = scope;
      return parsed;
    } catch {
      return null;
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

  async #loadDocumentFromManifest(entry: SkillManifestEntry): Promise<(SkillDocument & { skill: Skill }) | null> {
    const sourcePath = entry.sourcePath ?? entry.source_path;
    const fullPath = await this.#resolveManifestPath(sourcePath);
    try {
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseSkillMarkdown(raw, sourcePath);
      if (!parsed) return null;
      parsed.manifest.scope = entry.scope;
      parsed.manifest.enabled = entry.enabled;
      parsed.manifest.priority = entry.priority;
      parsed.manifest.sourcePath = sourcePath;
      parsed.manifest.source_path = sourcePath;
      return parsed;
    } catch {
      return null;
    }
  }

  async #resolveManifestPath(sourcePath: string): Promise<string> {
    const normalized = normalizePath(sourcePath);
    if (normalized.startsWith('skills/builtin/') || normalized.startsWith('packages/agent/skills/builtin/')) {
      const relative = normalized.replace(/^packages\/agent\/skills\/builtin\//, '').replace(/^skills\/builtin\//, '');
      const candidates = [
        ...this.builtinSkillsRoots.map((root) => path.join(root, relative)),
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

  #registerDocument(document: SkillDocument & { skill?: Skill }): void {
    const manifest = {
      ...document.manifest,
      sourcePath: document.manifest.sourcePath ?? document.manifest.source_path,
      source_path: document.manifest.source_path ?? document.manifest.sourcePath,
    };
    const skill = document.skill ?? {
      id: manifest.id,
      name: manifest.name,
      trigger_condition: manifest.triggers.join(' ') || manifest.description || manifest.name,
      trigger_pattern: manifest.trigger_pattern,
      steps: [],
      pitfalls: [],
      task_type: manifest.task_type,
      created_at: Date.now(),
      updated_at: Date.parse(manifest.updated_at) || Date.now(),
      call_count: 0,
      success_count: 0,
    };
    this.manifest.set(manifest.id, manifest);
    this.skills.set(skill.id, skill);
    this.documents.set(manifest.id, { manifest, body: document.body, raw: document.raw });
  }

  async #tryLoadLegacySkillArray(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const arr = JSON.parse(raw) as Skill[];
      if (!Array.isArray(arr)) return false;
      let migrated = false;
      for (const skill of arr) {
        if (!skill || typeof skill.id !== 'string') continue;
        await this.save(skill);
        migrated = true;
      }
      return migrated;
    } catch {
      return false;
    }
  }
}
