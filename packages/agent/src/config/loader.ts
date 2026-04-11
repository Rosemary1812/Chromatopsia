/**
 * Config Loader — YAML 配置加载 + 环境变量替换
 *
 * 支持 `${VAR_NAME}` 语法从 `process.env` 读取环境变量，
 * 变量不存在时替换为空字符串，不抛出错误。
 */

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { parse } from 'yaml';
import { existsSync } from 'fs';
import type { AppConfig } from '../foundation/types.js';

/** 匹配 YAML 中的 `${VAR_NAME}` 环境变量占位符 */
const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * 加载 .env 文件，将变量注入 process.env。
 * 从 config.yaml 同级目录查找 .env 文件。
 */
async function load_env_file(filePath: string): Promise<void> {
  const envPath = resolve(dirname(filePath), '.env');
  if (!existsSync(envPath)) return;

  const raw = await readFile(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // 去除首尾引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) process.env[key] = value;
  }
}

/**
 * 递归遍历 YAML 对象，替换所有字符串值中的 `${VAR}` 占位符。
 *
 * @param obj - YAML 解析后的任意值（string / array / object / primitive）
 * @returns 替换后的同构对象，变量不存在时替换为空字符串
 */
function substitute_env_vars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(ENV_VAR_PATTERN, (_, varName) => {
      return process.env[varName] ?? '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(substitute_env_vars);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substitute_env_vars(value);
    }
    return result;
  }
  return obj;
}

/**
 * 加载 YAML 配置文件。
 *
 * 默认路径为 `process.cwd()/config.yaml`，也可通过 `configPath` 指定。
 * 加载完成后自动执行环境变量替换。
 *
 * @param configPath - 可选，配置文件绝对路径。默认使用 `process.cwd()/config.yaml`
 * @returns 解析后的 AppConfig 对象
 * @throws Error - 配置文件不存在时抛出，消息包含文件路径
 */
export async function load_config(configPath?: string): Promise<AppConfig> {
  const defaultPath = resolve(process.cwd(), 'config.yaml');
  const filePath = configPath ? resolve(configPath) : defaultPath;

  // 配置文件不存在时抛出友好错误，不返回空对象
  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  // 在 config.yaml 同级目录查找 .env
  await load_env_file(filePath);

  const raw = await readFile(filePath, 'utf-8');
  const parsed = parse(raw) as Record<string, unknown>;
  const withEnvVars = substitute_env_vars(parsed) as AppConfig;

  return withEnvVars;
}
