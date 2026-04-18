import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ResolvedConfigPath {
  path: string | null;
  source: 'explicit' | 'project' | 'legacy-project' | 'user' | 'missing';
}

export function getUserConfigDir(): string {
  return path.join(os.homedir(), '.chromatopsia');
}

export function getUserConfigPath(): string {
  return path.join(getUserConfigDir(), 'config.yaml');
}

export function getProjectConfigPath(workingDir: string): string {
  return path.join(path.resolve(workingDir), '.chromatopsia', 'config.yaml');
}

export function getLegacyProjectConfigPath(workingDir: string): string {
  return path.join(path.resolve(workingDir), 'config.yaml');
}

export function resolveConfigPath(options: {
  workingDir: string;
  explicitPath?: string;
}): ResolvedConfigPath {
  if (options.explicitPath) {
    const resolvedPath = path.resolve(options.explicitPath);
    if (!existsSync(resolvedPath)) {
      return {
        path: null,
        source: 'missing',
      };
    }
    return {
      path: resolvedPath,
      source: 'explicit',
    };
  }

  const candidates: Array<Omit<ResolvedConfigPath, 'path'> & { path: string }> = [
    {
      path: getProjectConfigPath(options.workingDir),
      source: 'project',
    },
    {
      path: getLegacyProjectConfigPath(options.workingDir),
      source: 'legacy-project',
    },
    {
      path: getUserConfigPath(),
      source: 'user',
    },
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return candidate;
    }
  }

  return {
    path: null,
    source: 'missing',
  };
}
