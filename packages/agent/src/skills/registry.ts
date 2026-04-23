import type { Skill, SkillManifestEntry } from '../foundation/types.js';

export class SkillRegistry {
  private skills = new Map<string, Skill>(); // id → Skill
  private manifest = new Map<string, SkillManifestEntry>(); // id → SkillManifestEntry
  private by_type = new Map<string, Skill[]>(); // task_type → Skill[]
  private by_name = new Map<string, SkillManifestEntry>();

  register(skill: Skill): void {
    let manifest = this.manifest.get(skill.id);
    if (!manifest) {
      manifest = {
        id: skill.id,
        name: skill.name,
        description: skill.trigger_condition,
        userInvocable: true,
        context: 'inline',
        paths: [],
        triggers: [skill.trigger_condition],
        trigger_pattern: skill.trigger_pattern,
        task_type: skill.task_type,
        scope: 'user',
        enabled: true,
        priority: 50,
        version: 1,
        updated_at: new Date(skill.updated_at || Date.now()).toISOString(),
        sourcePath: `.chromatopsia/skills/user/${skill.id}/SKILL.md`,
        source_path: `.chromatopsia/skills/user/${skill.id}/SKILL.md`,
      };
      this.register_manifest(manifest);
    }
    if (!manifest.enabled || manifest.scope === 'learning_draft') {
      return;
    }
    this.skills.set(skill.id, skill);
    const list = this.by_type.get(skill.task_type) ?? [];
    const existingIdx = list.findIndex((s) => s.id === skill.id);
    if (existingIdx !== -1) {
      list[existingIdx] = skill;
    } else {
      list.push(skill);
    }
    this.by_type.set(skill.task_type, list);
  }

  register_manifest(entry: SkillManifestEntry): void {
    this.manifest.set(entry.id, entry);
    this.by_name.set(entry.name.toLowerCase(), entry);
    this.by_name.set(entry.id.toLowerCase(), entry);
  }

  match(task_type: string): Skill | null {
    return this.by_type.get(task_type)?.[0] ?? null;
  }

  fuzzy_match(query: string): Skill[] {
    const q = query.toLowerCase();
    return [...this.skills.values()].filter(
      (s) =>
        s.trigger_condition.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q),
    );
  }

  /**
   * 按用户输入匹配 Skill。
   * 检查 trigger_pattern（正则，权重+100）、trigger_condition（关键词，权重+50）、
   * name（模糊，权重+5），得分 > 30 才触发。
   */
  trigger_match(input: string): SkillManifestEntry | null {
    const q = input.toLowerCase();
    let best: SkillManifestEntry | null = null;
    let bestScore = 0;

    for (const skill of this.skills.values()) {
      const manifest = this.manifest.get(skill.id);
      if (manifest && (!manifest.enabled || manifest.scope === 'learning_draft')) {
        continue;
      }
      let score = 0;

      // 1. trigger_pattern 正则匹配（权重最高）
      if (skill.trigger_pattern) {
        try {
          const re = new RegExp(skill.trigger_pattern, 'i');
          if (re.test(input)) score += 100;
        } catch {
          // 无效正则，跳过
        }
      }

      // 2. trigger_condition 关键词匹配
      if (skill.trigger_condition) {
        const tc = skill.trigger_condition.toLowerCase();
        if (q.includes(tc)) score += 50;
        // 关键词重叠计数
        const words = tc.split(/\s+/);
        for (const w of words) {
          if (w.length > 2 && q.includes(w)) score += 10;
        }
      }

      // 3. name 匹配
      if (skill.name.toLowerCase().includes(q)) score += 5;

      if (score > bestScore) {
        bestScore = score;
        best = manifest ?? this.manifest.get(skill.id) ?? null;
      }
    }

    return bestScore > 30 ? best : null;
  }

  update(id: string, patch: Partial<Skill>): void {
    const skill = this.skills.get(id);
    if (!skill) return;
    const updated = { ...skill, ...patch, updated_at: Date.now() };
    this.skills.set(id, updated);
    const list = this.by_type.get(skill.task_type);
    if (list) {
      const idx = list.findIndex((s) => s.id === id);
      if (idx !== -1) list[idx] = updated;
    }
    const manifest = this.manifest.get(id);
    if (manifest) {
      manifest.name = updated.name;
      manifest.task_type = updated.task_type;
      manifest.updated_at = new Date(updated.updated_at).toISOString();
      manifest.trigger_pattern = updated.trigger_pattern;
    }
  }

  list(): string[] {
    const all = [...this.skills.values()];
    if (all.length === 0) {
      return [];
    }
    return all.map((s) => `${s.name} (${s.task_type})`);
  }

  show(name: string): string | null {
    const skill = [...this.skills.values()].find((s) => s.name === name);
    if (!skill) {
      return null;
    }
    return JSON.stringify(skill, null, 2);
  }

  delete(name: string): void {
    const skill = [...this.skills.values()].find((s) => s.name === name);
    if (!skill) return;
    this.skills.delete(skill.id);
    this.manifest.delete(skill.id);
    this.by_name.delete(skill.id.toLowerCase());
    this.by_name.delete(skill.name.toLowerCase());
    const list = this.by_type.get(skill.task_type);
    if (list) {
      const filtered = list.filter((s) => s.id !== skill.id);
      if (filtered.length === 0) {
        this.by_type.delete(skill.task_type);
      } else {
        this.by_type.set(skill.task_type, filtered);
      }
    }
  }

  search(query: string): string[] {
    const results = this.fuzzy_match(query);
    if (results.length === 0) {
      return [];
    }
    return results.map((s) => `${s.name} — ${s.trigger_condition}`);
  }

  getAll(): Skill[] {
    return [...this.skills.values()];
  }

  getById(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  getManifestByName(name: string): SkillManifestEntry | undefined {
    return this.by_name.get(name.toLowerCase());
  }

  listAvailableSkills(): Array<Pick<SkillManifestEntry, 'name' | 'description' | 'scope' | 'priority'>> {
    return this.getManifest()
      .filter((entry) => entry.enabled && entry.scope !== 'learning_draft')
      .map((entry) => ({
        name: entry.name,
        description: entry.description,
        scope: entry.scope,
        priority: entry.priority,
      }));
  }

  getManifest(): SkillManifestEntry[] {
    return [...this.manifest.values()].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.name.localeCompare(b.name);
    });
  }

  build_directory_listing(): string {
    const entries = this.getManifest().filter((e) => e.enabled);
    if (entries.length === 0) return '';
    const lines = ['Available skills (load full guidance with the Skill tool when useful):'];
    for (const entry of entries) {
      lines.push(
        `- ${entry.name}: ${entry.description || 'No description'} (scope=${entry.scope})`,
      );
    }
    return lines.join('\n');
  }
}
