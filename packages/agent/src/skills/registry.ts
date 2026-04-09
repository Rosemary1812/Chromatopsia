import type { Skill } from '../types.js';

export class SkillRegistry {
  private skills = new Map<string, Skill>(); // id → Skill
  private by_type = new Map<string, Skill[]>(); // task_type → Skill[]

  register(skill: Skill): void {
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
  }

  list(): void {
    const all = [...this.skills.values()];
    if (all.length === 0) {
      console.log('No skills registered.');
      return;
    }
    console.log(all.map((s) => `${s.name} (${s.task_type})`).join('\n'));
  }

  show(name: string): void {
    const skill = [...this.skills.values()].find((s) => s.name === name);
    if (!skill) {
      console.log(`Skill "${name}" not found.`);
      return;
    }
    console.log(JSON.stringify(skill, null, 2));
  }

  delete(name: string): void {
    const skill = [...this.skills.values()].find((s) => s.name === name);
    if (!skill) return;
    this.skills.delete(skill.id);
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

  search(query: string): void {
    const results = this.fuzzy_match(query);
    if (results.length === 0) {
      console.log(`No skills found for "${query}".`);
      return;
    }
    console.log(
      results.map((s) => `${s.name} — ${s.trigger_condition}`).join('\n'),
    );
  }

  getAll(): Skill[] {
    return [...this.skills.values()];
  }

  getById(id: string): Skill | undefined {
    return this.skills.get(id);
  }
}
