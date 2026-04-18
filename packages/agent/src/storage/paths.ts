import { existsSync } from 'fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AppConfig } from '../foundation/types.js';

export interface StoragePaths {
  projectRoot: string;
  root: string;
  sessionsDir: string;
  sessionsIndexPath: string;
  learningDir: string;
  turnEventsPath: string;
  learningStatePath: string;
  memoryDir: string;
  memoryIndexPath: string;
  skillsDir: string;
  skillsIndexPath: string;
  userSkillsDir: string;
  draftSkillsDir: string;
  logsDir: string;
  builtinSkillsRoots: string[];
}

function hasMarker(dir: string, marker: string): boolean {
  return existsSync(path.join(dir, marker));
}

export function resolveProjectRoot(workingDir: string, configPath?: string): string {
  if (configPath) {
    return path.dirname(path.resolve(configPath));
  }

  let current = path.resolve(workingDir);
  let gitCandidate: string | null = null;

  while (true) {
    if (hasMarker(current, 'config.yaml')) return current;
    if (hasMarker(current, 'pnpm-workspace.yaml')) return current;
    if (hasMarker(current, '.git')) gitCandidate = current;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return gitCandidate ?? path.resolve(workingDir);
}

export function resolveStoragePaths(options: {
  workingDir: string;
  appConfig?: AppConfig;
  configPath?: string;
}): StoragePaths {
  const projectRoot = resolveProjectRoot(options.workingDir, options.configPath);
  const rootDir = options.appConfig?.storage?.root_dir ?? '.chromatopsia';
  const storageMode = options.appConfig?.storage?.mode ?? 'project';
  const root = storageMode === 'home'
    ? path.join(os.homedir(), '.chromatopsia')
    : path.join(projectRoot, rootDir);
  const skillsDir = path.join(root, 'skills');
  const learningDir = path.join(root, 'learning');
  const logsDir = path.join(root, 'logs');
  const sessionsDir = path.join(root, 'sessions');
  const memoryDir = path.join(root, 'memory');
  const packageRoot = process.env.CHROMATOPSIA_PACKAGE_ROOT
    ? path.resolve(process.env.CHROMATOPSIA_PACKAGE_ROOT)
    : null;

  return {
    projectRoot,
    root,
    sessionsDir,
    sessionsIndexPath: path.join(sessionsDir, 'index.json'),
    learningDir,
    turnEventsPath: path.join(learningDir, 'turn-events.jsonl'),
    learningStatePath: path.join(learningDir, 'state.json'),
    memoryDir,
    memoryIndexPath: path.join(memoryDir, 'MEMORY.md'),
    skillsDir,
    skillsIndexPath: path.join(skillsDir, 'index.json'),
    userSkillsDir: path.join(skillsDir, 'user'),
    draftSkillsDir: path.join(skillsDir, 'drafts'),
    logsDir,
    builtinSkillsRoots: [
      path.join(projectRoot, 'skills', 'builtin'),
      path.join(projectRoot, 'packages', 'agent', 'skills', 'builtin'),
      ...(packageRoot
        ? [
            path.join(packageRoot, 'dist', 'agent', 'skills', 'builtin'),
            path.join(packageRoot, 'packages', 'agent', 'skills', 'builtin'),
          ]
        : []),
    ],
  };
}
