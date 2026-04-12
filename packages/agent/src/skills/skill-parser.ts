import type { Skill, SkillManifestEntry, SkillScope } from '../foundation/types.js';

export interface ParsedSkillDocument {
  manifest: SkillManifestEntry;
  skill: Skill;
  raw: string;
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) {
    return null;
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== '---') {
    return null;
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return null;
  }
  const frontmatter = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n').trim();
  return { frontmatter, body };
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
      const list = (out[currentListKey] as string[]) ?? [];
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

function extractSection(body: string, title: string): string | null {
  // Body starts with "## 适用场景\n..." (no leading \n from splitFrontmatter)
  // Each section starts with "## <title>\n<content>"
  // Split by '\n## ' to get sections
  // Note: using indexOf approach to avoid regex complexity with blank lines
  const marker = `\n## ${title}\n`;
  const idx = body.indexOf(marker);
  if (idx === -1) {
    // Try with space after ##: "## <title>\n"
    const marker2 = `## ${title}\n`;
    const idx2 = body.indexOf(marker2);
    if (idx2 === -1) return null;
    // Extract everything after this heading until the next "## " at line start
    const rest = body.slice(idx2 + marker2.length);
    const nextHeading = rest.indexOf('\n## ');
    return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  }
  // Extract everything after this heading until the next "## " at line start
  const rest = body.slice(idx + marker.length);
  const nextHeading = rest.indexOf('\n## ');
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
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

function parseListOrSingle(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function parseScope(value: string | string[] | undefined): SkillScope {
  if (typeof value !== 'string') return 'user';
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

function parseSteps(section: string | null): string[] {
  if (!section) return [];
  const lines = section.split(/\r?\n/).map((line) => line.trim());
  return lines
    .filter((line) => /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean);
}

function parseBullets(section: string | null): string[] {
  if (!section) return [];
  const lines = section.split(/\r?\n/).map((line) => line.trim());
  return lines
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, '').trim())
    .filter(Boolean);
}

export function parseSkillMarkdown(raw: string, sourcePath: string): ParsedSkillDocument | null {
  const fm = splitFrontmatter(raw);
  if (!fm) return null;
  const data = parseYamlLike(fm.frontmatter);

  const id = typeof data.id === 'string' && data.id ? data.id : '';
  const name = typeof data.name === 'string' && data.name ? data.name : '';
  if (!id || !name) return null;

  const description = typeof data.description === 'string' ? data.description : '';
  const task_type = typeof data.task_type === 'string' && data.task_type ? data.task_type : 'general';
  const triggers = parseListOrSingle(data.triggers);
  const trigger_pattern =
    typeof data.trigger_pattern === 'string' && data.trigger_pattern ? data.trigger_pattern : undefined;
  const scope = parseScope(data.scope);
  const enabled = parseBoolean(data.enabled, true);
  const priority = parseNumber(data.priority, 50);
  const version = parseNumber(data.version, 1);
  const updated_at_iso =
    typeof data.updated_at === 'string' && data.updated_at ? data.updated_at : new Date().toISOString();

  const steps = parseSteps(extractSection(fm.body, '操作步骤'));
  const pitfalls = parseBullets(extractSection(fm.body, '注意事项'));
  const verification = extractSection(fm.body, '验证方式') ?? undefined;

  const updated_at = toTimestamp(data.updated_at);
  const created_at = toTimestamp(data.created_at);
  const call_count = parseNumber(data.call_count, 0);
  const success_count = parseNumber(data.success_count, 0);
  const trigger_condition =
    typeof data.trigger_condition === 'string'
      ? data.trigger_condition
      : (triggers.join(' ') || description || name);

  const manifest: SkillManifestEntry = {
    id,
    name,
    description,
    triggers,
    trigger_pattern,
    task_type,
    scope,
    enabled,
    priority,
    version,
    updated_at: updated_at_iso,
    source_path: sourcePath,
  };

  const skill: Skill = {
    id,
    name,
    trigger_condition,
    trigger_pattern,
    steps,
    pitfalls,
    verification,
    task_type,
    created_at,
    updated_at,
    call_count,
    success_count,
  };

  return { manifest, skill, raw };
}

export function serializeSkillMarkdown(manifest: SkillManifestEntry, skill: Skill): string {
  const triggerLines = manifest.triggers.map((t) => `  - ${t}`).join('\n');
  const stepLines = skill.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const pitfallLines = skill.pitfalls.map((p) => `- ${p}`).join('\n');

  return [
    '---',
    `id: ${manifest.id}`,
    `name: ${manifest.name}`,
    `description: ${manifest.description}`,
    `triggers:`,
    triggerLines || '  - ',
    `trigger_pattern: ${manifest.trigger_pattern ?? ''}`,
    `trigger_condition: ${skill.trigger_condition}`,
    `task_type: ${manifest.task_type}`,
    `scope: ${manifest.scope}`,
    `enabled: ${manifest.enabled}`,
    `priority: ${manifest.priority}`,
    `version: ${manifest.version}`,
    `updated_at: ${manifest.updated_at}`,
    `created_at: ${new Date(skill.created_at).toISOString()}`,
    `call_count: ${skill.call_count}`,
    `success_count: ${skill.success_count}`,
    '---',
    '',
    '## 适用场景',
    manifest.description ? `- ${manifest.description}` : '- ',
    '',
    '## 操作步骤',
    stepLines || '1. ',
    '',
    '## 注意事项',
    pitfallLines || '- ',
    '',
    '## 验证方式',
    skill.verification ?? '- ',
    '',
  ].join('\n');
}
