import type { Skill, SkillDocument, SkillManifestEntry, SkillScope } from '../foundation/types.js';

export interface ParsedSkillDocument extends SkillDocument {
  /** Compatibility view for legacy callers. Body is no longer parsed into executable steps. */
  skill: Skill;
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return null;

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== '---') return null;

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return null;

  return {
    frontmatter: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n').trim(),
  };
}

function parseYamlLike(frontmatter: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = frontmatter.split(/\r?\n/);
  let currentListKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('- ') && currentListKey) {
      const item = line.slice(2).trim().replace(/^["']|["']$/g, '');
      const list = Array.isArray(out[currentListKey]) ? out[currentListKey] as string[] : [];
      list.push(item);
      out[currentListKey] = list;
      continue;
    }

    const idx = line.indexOf(':');
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value === '') {
      out[key] = [];
      currentListKey = key;
      continue;
    }

    currentListKey = null;
    out[key] = value.replace(/^["']|["']$/g, '');
  }

  return out;
}

function parseNumber(value: string | string[] | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(value: string | string[] | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const lowered = value.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  return fallback;
}

function parseContext(value: string | string[] | undefined): SkillManifestEntry['context'] {
  return value === 'fork' ? 'fork' : 'inline';
}

function parseListOrSingle(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function parseScope(value: string | string[] | undefined): SkillScope {
  if (value === 'builtin' || value === 'user' || value === 'project' || value === 'learning_draft') {
    return value;
  }
  return 'user';
}

function toTimestamp(value: string | string[] | undefined): number {
  if (typeof value !== 'string') return Date.now();
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Date.now();
}

function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '') || 'skill';
}

export function parseSkillMarkdown(raw: string, sourcePath: string): ParsedSkillDocument | null {
  const fm = splitFrontmatter(raw);
  if (!fm) return null;

  const data = parseYamlLike(fm.frontmatter);
  const name = typeof data.name === 'string' && data.name ? data.name : '';
  if (!name) return null;

  const id = typeof data.id === 'string' && data.id ? data.id : slugifyName(name);
  const description = typeof data.description === 'string' ? data.description : '';
  const triggers = parseListOrSingle(data.triggers);
  const trigger_pattern = typeof data.trigger_pattern === 'string' && data.trigger_pattern ? data.trigger_pattern : undefined;
  const task_type = typeof data.task_type === 'string' && data.task_type ? data.task_type : 'general';
  const updated_at = typeof data.updated_at === 'string' && data.updated_at ? data.updated_at : new Date().toISOString();
  const normalizedSource = sourcePath.replace(/\\/g, '/');

  const manifest: SkillManifestEntry = {
    id,
    name,
    description,
    userInvocable: parseBoolean(data['user-invocable'] ?? data.userInvocable, true),
    context: parseContext(data.context),
    agent: typeof data.agent === 'string' && data.agent ? data.agent : undefined,
    paths: parseListOrSingle(data.paths),
    triggers,
    trigger_pattern,
    task_type,
    scope: parseScope(data.scope),
    enabled: parseBoolean(data.enabled, true),
    priority: parseNumber(data.priority, 50),
    version: parseNumber(data.version, 1),
    updated_at,
    sourcePath: normalizedSource,
    source_path: normalizedSource,
  };

  const trigger_condition = typeof data.trigger_condition === 'string'
    ? data.trigger_condition
    : (triggers.join(' ') || description || name);
  const skill: Skill = {
    id,
    name,
    trigger_condition,
    trigger_pattern,
    steps: [],
    pitfalls: [],
    verification: undefined,
    task_type,
    created_at: toTimestamp(data.created_at),
    updated_at: toTimestamp(data.updated_at),
    call_count: parseNumber(data.call_count, 0),
    success_count: parseNumber(data.success_count, 0),
  };

  return { manifest, skill, body: fm.body, raw };
}

function yamlList(key: string, values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return [key, ...values.map((value) => `  - ${value}`)];
}

export function serializeSkillMarkdown(manifest: SkillManifestEntry, skillOrBody: Skill | string): string {
  const body = typeof skillOrBody === 'string'
    ? skillOrBody.trim()
    : [
        '# ' + manifest.name,
        '',
        '## When To Use',
        manifest.description || skillOrBody.trigger_condition || 'Describe when to use this skill.',
        '',
        '## Procedure',
        'Describe the recommended approach in prose. Do not encode executable macro steps.',
        '',
        '## Verification',
        'Describe how to verify the work is complete.',
      ].join('\n');

  const lines = [
    '---',
    `id: ${manifest.id}`,
    `name: ${manifest.name}`,
    `description: ${manifest.description}`,
    `user-invocable: ${manifest.userInvocable}`,
    `context: ${manifest.context}`,
    ...(manifest.agent ? [`agent: ${manifest.agent}`] : []),
    ...yamlList('paths:', manifest.paths),
    ...yamlList('triggers:', manifest.triggers),
    ...(manifest.trigger_pattern ? [`trigger_pattern: ${manifest.trigger_pattern}`] : []),
    `task_type: ${manifest.task_type}`,
    `scope: ${manifest.scope}`,
    `enabled: ${manifest.enabled}`,
    `priority: ${manifest.priority}`,
    `version: ${manifest.version}`,
    `updated_at: ${manifest.updated_at}`,
    '---',
    '',
    body,
    '',
  ];

  return lines.join('\n');
}
