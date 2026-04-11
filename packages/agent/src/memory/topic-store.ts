import * as fs from 'fs/promises';
import * as path from 'path';
import type { MemoryType } from '../foundation/types.js';

interface MemoryTopicMeta {
  name: string;
  description: string;
  type: MemoryType;
  updated_at: string;
  confidence: number;
  status: 'active' | 'merged' | 'deprecated';
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeTopicName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `memory-${Date.now()}`;
}

function parseMeta(raw: string): MemoryTopicMeta | null {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const map = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  const name = map.get('name');
  const description = map.get('description');
  const type = map.get('type') as MemoryType | undefined;
  if (!name || !description || !type) return null;
  return {
    name,
    description,
    type,
    updated_at: map.get('updated_at') ?? nowIso(),
    confidence: Number(map.get('confidence') ?? '0.8'),
    status: (map.get('status') as MemoryTopicMeta['status']) ?? 'active',
  };
}

function renderMeta(meta: MemoryTopicMeta): string {
  return [
    '---',
    `name: ${meta.name}`,
    `description: ${meta.description}`,
    `type: ${meta.type}`,
    `updated_at: ${meta.updated_at}`,
    `confidence: ${meta.confidence}`,
    `status: ${meta.status}`,
    '---',
  ].join('\n');
}

export class MemoryTopicStore {
  private memoryDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
  }

  filePath(name: string): string {
    return path.join(this.memoryDir, `${sanitizeTopicName(name)}.md`);
  }

  async read(fileName: string): Promise<string> {
    const full = path.join(this.memoryDir, fileName);
    return fs.readFile(full, 'utf-8');
  }

  async appendEntry(params: {
    name: string;
    description: string;
    type: MemoryType;
    entry: string;
    fileName?: string;
    confidence?: number;
  }): Promise<{ file: string; updated_at: string }> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    const target = params.fileName ?? `${sanitizeTopicName(params.name)}.md`;
    const full = path.join(this.memoryDir, target);
    const timestamp = nowIso();
    let current = '';
    let meta: MemoryTopicMeta | null = null;
    try {
      current = await fs.readFile(full, 'utf-8');
      meta = parseMeta(current);
    } catch {
      // new file
    }

    const nextMeta: MemoryTopicMeta = {
      name: params.name,
      description: params.description,
      type: params.type,
      updated_at: timestamp,
      confidence: params.confidence ?? meta?.confidence ?? 0.8,
      status: 'active',
    };

    const entryLine = `- [${timestamp}] ${params.entry.trim()}`;
    let body = current;
    if (!meta) {
      body = [
        renderMeta(nextMeta),
        '',
        '## What',
        params.description,
        '',
        '## Why',
        '-',
        '',
        '## How to apply',
        '-',
        '',
        '## Entries',
        entryLine,
        '',
      ].join('\n');
    } else {
      const replaced = current.replace(/^---[\s\S]*?---/, renderMeta(nextMeta));
      if (/\n## Entries\s*\n/.test(replaced)) {
        body = replaced.replace(/\n## Entries\s*\n([\s\S]*)$/, (_m, entries) => `\n## Entries\n${entries.trim()}\n${entryLine}\n`);
      } else {
        body = `${replaced.trim()}\n\n## Entries\n${entryLine}\n`;
      }
    }

    await fs.writeFile(full, body, 'utf-8');
    return { file: target, updated_at: timestamp };
  }
}

