// Placeholder - to be implemented in Phase 4
import type { Skill } from '../types.js';

export class SkillRegistry {
  register(_skill: Skill): void { throw new Error('Not implemented yet'); }
  match(_task_type: string): Skill | null { throw new Error('Not implemented yet'); }
  fuzzy_match(_query: string): Skill[] { throw new Error('Not implemented yet'); }
  list(): void {}
  show(_name: string): void {}
  delete(_name: string): void {}
}
