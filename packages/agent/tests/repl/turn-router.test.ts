import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEventInput } from '../../src/repl/runtime.js';
import { createLearningCommandHandler } from '../../src/repl/turn-router.js';

const draftDocument = {
  manifest: {
    id: 'draft-skill',
    name: 'Draft Skill',
    description: 'Draft guidance description',
    userInvocable: true,
    context: 'inline' as const,
    triggers: ['draft trigger'],
    task_type: 'git',
    scope: 'learning_draft' as const,
    enabled: false,
    priority: 10,
    version: 1,
    updated_at: '2026-04-23T00:00:00.000Z',
    sourcePath: '.chromatopsia/skills/drafts/draft-skill/SKILL.md',
    source_path: '.chromatopsia/skills/drafts/draft-skill/SKILL.md',
  },
  body: '# Draft Skill\n\n## Procedure\nReview this full guidance.',
  raw: '---\nid: draft-skill\nname: Draft Skill\n---\n\n# Draft Skill\n\n## Procedure\nReview this full guidance.',
};

describe('repl/turn-router learning commands', () => {
  it('reviews draft skill summaries and full SKILL.md content', async () => {
    const events: RuntimeEventInput[] = [];
    const handler = createLearningCommandHandler({
      skillStore: {
        list_drafts: vi.fn(() => [{ id: 'draft-skill', name: 'Draft Skill', task_type: 'git' }]),
        loadDocument: vi.fn(async () => draftDocument),
      } as never,
      skillRegistry: { register: vi.fn(), register_manifest: vi.fn() } as never,
      emitRuntime: (event) => events.push(event),
    });

    await expect(handler('/skill review draft-skill', 'turn-1')).resolves.toBe(true);
    await expect(handler('/skill review draft-skill full', 'turn-2')).resolves.toBe(true);

    const summary = events.find((event) => event.type === 'turn_completed' && event.turnId === 'turn-1');
    const full = events.find((event) => event.type === 'turn_completed' && event.turnId === 'turn-2');
    expect(summary && summary.type === 'turn_completed' ? summary.content : '').toContain('Draft guidance description');
    expect(summary && summary.type === 'turn_completed' ? summary.content : '').toContain('Use /skill review draft-skill full');
    expect(full && full.type === 'turn_completed' ? full.content : '').toContain('---\nid: draft-skill');
    expect(full && full.type === 'turn_completed' ? full.content : '').toContain('Review this full guidance.');
  });

  it('registers approved draft manifest from the published user SKILL.md document', async () => {
    const registerManifest = vi.fn();
    const register = vi.fn();
    const approved = {
      id: 'draft-skill',
      name: 'Draft Skill',
      trigger_condition: 'draft trigger',
      steps: [],
      pitfalls: [],
      task_type: 'git',
      created_at: Date.now(),
      updated_at: Date.now(),
      call_count: 0,
      success_count: 0,
    };
    const publishedDocument = {
      ...draftDocument,
      manifest: {
        ...draftDocument.manifest,
        scope: 'user' as const,
        enabled: true,
        priority: 50,
        sourcePath: '.chromatopsia/skills/user/draft-skill/SKILL.md',
        source_path: '.chromatopsia/skills/user/draft-skill/SKILL.md',
      },
    };
    const handler = createLearningCommandHandler({
      skillStore: {
        list_drafts: vi.fn(() => []),
        approve_draft: vi.fn(async () => approved),
        loadDocument: vi.fn(async () => publishedDocument),
      } as never,
      skillRegistry: { register, register_manifest: registerManifest } as never,
      emitRuntime: vi.fn(),
    });

    await expect(handler('/skill approve draft-skill', 'turn-1')).resolves.toBe(true);

    expect(registerManifest).toHaveBeenCalledWith(expect.objectContaining({
      id: 'draft-skill',
      scope: 'user',
      source_path: '.chromatopsia/skills/user/draft-skill/SKILL.md',
    }));
    expect(register).toHaveBeenCalledWith(approved);
  });
});
