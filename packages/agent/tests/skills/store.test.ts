import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { SkillStore } from '../../src/skills/store.js';
import type { Skill } from '../../src/foundation/types.js';

const TEST_DIR = resolve(process.cwd(), '.test-skill-store-temp');

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-test-001',
  name: 'Test Skill',
  task_type: 'test-task',
  trigger_condition: 'run tests',
  steps: ['run_shell command="echo a"'],
  pitfalls: ['pitfall1'],
  created_at: Date.now(),
  updated_at: Date.now(),
  call_count: 0,
  success_count: 0,
  ...overrides,
});

describe('SkillStore', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('saves markdown file and writes project-local skills index', async () => {
    const store = new SkillStore(TEST_DIR);
    const skill = makeSkill({ id: 's1', name: 'Git Rebase' });
    await store.save(skill);

    const indexRaw = await readFile(resolve(TEST_DIR, '.chromatopsia', 'skills', 'index.json'), 'utf-8');
    const index = JSON.parse(indexRaw) as { skills: Array<{ id: string; source_path: string }> };
    expect(index.skills.some((s) => s.id === 's1')).toBe(true);

    const mdPath = resolve(TEST_DIR, '.chromatopsia', 'skills', 'user', 's1.md');
    const mdRaw = await readFile(mdPath, 'utf-8');
    expect(mdRaw).toContain('id: s1');
    expect(mdRaw).toContain('name: Git Rebase');
  });

  it('loads skills from index + markdown files', async () => {
    const store = new SkillStore(TEST_DIR);
    const skill = makeSkill({ id: 's1', name: 'Load Me' });
    await store.save(skill);

    const loaded = new SkillStore(TEST_DIR);
    await loaded.load();
    expect(loaded.getAll()).toHaveLength(1);
    expect(loaded.getAll()[0].name).toBe('Load Me');
    expect(loaded.getManifest().some((m) => m.id === 's1')).toBe(true);
  });

  it('deletes skill markdown and removes from index', async () => {
    const store = new SkillStore(TEST_DIR);
    await store.save(makeSkill({ id: 's1' }));
    await store.delete('s1');

    const loaded = new SkillStore(TEST_DIR);
    await loaded.load();
    expect(loaded.getAll()).toHaveLength(0);
  });

  it('migrates legacy index array to markdown files', async () => {
    const skillsDir = resolve(TEST_DIR, '.chromatopsia', 'skills');
    await mkdir(skillsDir, { recursive: true });
    const legacy = [makeSkill({ id: 'legacy-1', name: 'Legacy Skill' })];
    await writeFile(resolve(skillsDir, 'index.json'), JSON.stringify(legacy, null, 2), 'utf-8');

    const store = new SkillStore(TEST_DIR);
    await store.load();

    const all = store.getAll();
    expect(all.some((s) => s.id === 'legacy-1')).toBe(true);

    const mdRaw = await readFile(resolve(TEST_DIR, '.chromatopsia', 'skills', 'user', 'legacy-1.md'), 'utf-8');
    expect(mdRaw).toContain('id: legacy-1');
  });

  it('fuzzySearch and byTaskType still work', async () => {
    const store = new SkillStore(TEST_DIR);
    await store.save(makeSkill({ id: 's1', name: 'Git Rebase', task_type: 'git-rebase' }));
    await store.save(makeSkill({ id: 's2', name: 'Run Tests', task_type: 'testing' }));

    expect(store.byTaskType('git-rebase')).toHaveLength(1);
    expect(store.fuzzySearch('rebase')).toHaveLength(1);
    expect(store.fuzzySearch('xyz')).toHaveLength(0);
  });

  it('loads runtime markdown files even if index was stale', async () => {
    const runtimeUserDir = resolve(TEST_DIR, '.chromatopsia', 'skills', 'user');
    const skillsDir = resolve(TEST_DIR, '.chromatopsia', 'skills');
    await mkdir(runtimeUserDir, { recursive: true });
    await writeFile(
      resolve(runtimeUserDir, 'manual.md'),
      `---
id: manual
name: Manual Skill
description: manual
triggers:
  - manual
trigger_condition: manual
task_type: general
scope: user
enabled: true
priority: 50
version: 1
updated_at: 2026-04-11T00:00:00.000Z
created_at: 2026-04-11T00:00:00.000Z
call_count: 0
success_count: 0
---

## 操作步骤
1. run_shell command="echo x"

## 注意事项
- none

## 验证方式
- ok`,
      'utf-8',
    );
    await writeFile(
      resolve(skillsDir, 'index.json'),
      JSON.stringify({ version: 1, updated_at: new Date().toISOString(), skills: [] }, null, 2),
      'utf-8',
    );

    const store = new SkillStore(TEST_DIR);
    await store.load();
    expect(store.getAll().some((s) => s.id === 'manual')).toBe(true);
  });

  it('supports draft save/list/approve/reject workflow', async () => {
    const store = new SkillStore(TEST_DIR);
    const draft = makeSkill({ id: 'draft-1', name: 'Draft Skill' });
    await store.save_draft(draft);

    const drafts = store.list_drafts();
    expect(drafts.some((d) => d.id === 'draft-1')).toBe(true);
    expect(store.getManifest().find((m) => m.id === 'draft-1')?.scope).toBe('learning_draft');

    const approved = await store.approve_draft('draft-1');
    expect(approved?.id).toBe('draft-1');

    const reloaded = new SkillStore(TEST_DIR);
    await reloaded.load();
    const manifest = reloaded.getManifest().find((m) => m.id === 'draft-1');
    expect(manifest?.scope).toBe('user');
    expect(manifest?.enabled).toBe(true);

    await reloaded.save_draft(makeSkill({ id: 'draft-2', name: 'Draft Reject' }));
    const rejected = await reloaded.reject_draft('draft-2');
    expect(rejected).toBe(true);
    expect(reloaded.list_drafts().some((d) => d.id === 'draft-2')).toBe(false);
  });
});
