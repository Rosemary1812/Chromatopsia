import * as fs from 'fs/promises';
import * as path from 'path';
import type { MemoryIndexEntry } from '../foundation/types.js';

const MEMORY_INDEX_FILE = 'MEMORY.md';
const MAX_INDEX_LINES = 200;

function nowIso(): string {
  return new Date().toISOString();
}

function toLine(entry: MemoryIndexEntry): string {
  const typeSeg = entry.type ? `type:${entry.type}; ` : '';
  const timeSeg = entry.updated_at ? `updated_at:${entry.updated_at}; ` : '';
  return `- [${entry.name}](${entry.file}) — ${typeSeg}${timeSeg}${entry.description}`.trim();
}

function parseLine(line: string): MemoryIndexEntry | null {
  const m = line.match(/^- \[([^\]]+)\]\(([^)]+)\)\s+—\s+(.+)$/);
  if (!m) return null;
  const name = m[1].trim();
  const file = m[2].trim();
  const rest = m[3].trim();
  let type: MemoryIndexEntry['type'];
  let updated_at: string | undefined;
  let description = rest;

  const typeMatch = rest.match(/type:(user|feedback|project|reference);\s*/);
  if (typeMatch) {
    type = typeMatch[1] as MemoryIndexEntry['type'];
    description = description.replace(typeMatch[0], '');
  }
  const timeMatch = rest.match(/updated_at:([0-9T:\-\.Z]+);\s*/);
  if (timeMatch) {
    updated_at = timeMatch[1];
    description = description.replace(timeMatch[0], '');
  }

  return { name, file, description: description.trim(), type, updated_at };
}

export class MemoryIndexStore {
  private memoryDir: string;
  private indexPath: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.indexPath = path.join(memoryDir, MEMORY_INDEX_FILE);
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    try {
      await fs.access(this.indexPath);
    } catch {
      const content = [
        '# MEMORY',
        '',
        '你有一个基于文件的持久记忆系统。先读索引，再按需读取主题文件。',
        '',
      ].join('\n');
      await fs.writeFile(this.indexPath, content, 'utf-8');
    }
  }

  async appendRawLine(line: string): Promise<void> {
    await this.ensure();
    const raw = await this.readRaw();
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    lines.push(line);
    const kept = lines.slice(0, 2).concat(lines.slice(2).slice(-MAX_INDEX_LINES));
    await fs.writeFile(this.indexPath, `${kept.join('\n')}\n`, 'utf-8');
  }

  async readRaw(): Promise<string> {
    await this.ensure();
    return fs.readFile(this.indexPath, 'utf-8');
  }

  async listEntries(): Promise<MemoryIndexEntry[]> {
    const raw = await this.readRaw();
    const lines = raw.split(/\r?\n/);
    const out: MemoryIndexEntry[] = [];
    for (const line of lines) {
      const parsed = parseLine(line.trim());
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async upsertEntry(entry: Omit<MemoryIndexEntry, 'updated_at'> & { updated_at?: string }): Promise<void> {
    const entries = await this.listEntries();
    const updated: MemoryIndexEntry = {
      ...entry,
      updated_at: entry.updated_at ?? nowIso(),
    };
    const idx = entries.findIndex((e) => e.name === updated.name || e.file === updated.file);
    if (idx >= 0) entries[idx] = updated;
    else entries.push(updated);

    const kept = entries.slice(-MAX_INDEX_LINES);
    const body = kept.map(toLine).join('\n');
    const content = ['# MEMORY', '', body ? body : '- [example](example.md) — type:user; updated_at:1970-01-01T00:00:00.000Z; 示例', ''].join('\n');
    await fs.writeFile(this.indexPath, content, 'utf-8');
  }
}

