/**
 * Config Loader 单元测试
 *
 * 测试范围：
 * 1. 基本 YAML 加载
 * 2. 环境变量替换（${VAR} → process.env[VAR]）
 * 3. 缺失环境变量时空字符串替换
 * 4. 配置文件不存在时抛出 Error
 * 5. openai provider 配置结构
 * 6. tools / approval 子配置结构
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { load_config } from '../src/config/loader.js';

const TEST_DIR = resolve(process.cwd(), '.test-config-temp');

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('load_config', () => {
  it('loads a YAML config file', async () => {
    const configPath = resolve(TEST_DIR, 'config.yaml');
    await writeFile(configPath, `
provider: anthropic
anthropic:
  api_key: sk-ant-test123
  model: claude-opus-4-6
`);
    const config = await load_config(configPath);
    expect(config.provider).toBe('anthropic');
    expect(config.anthropic?.api_key).toBe('sk-ant-test123');
    expect(config.anthropic?.model).toBe('claude-opus-4-6');
  });

  it('substitutes environment variables', async () => {
    const configPath = resolve(TEST_DIR, 'config-env.yaml');
    process.env.TEST_API_KEY = 'env-secret-key';
    await writeFile(configPath, `
provider: openai
openai:
  api_key: \${TEST_API_KEY}
`);
    const config = await load_config(configPath);
    expect(config.openai?.api_key).toBe('env-secret-key');
    delete process.env.TEST_API_KEY;
  });

  it('substitutes missing env vars with empty string', async () => {
    // NONEXISTENT_VAR_12345 确定不存在于环境变量中
    const configPath = resolve(TEST_DIR, 'config-missing.yaml');
    await writeFile(configPath, `
provider: anthropic
anthropic:
  api_key: \${NONEXISTENT_VAR_12345}
`);
    const config = await load_config(configPath);
    expect(config.anthropic?.api_key).toBe('');
  });

  it('throws when config file does not exist', async () => {
    const nonexistent = resolve(TEST_DIR, 'nonexistent.yaml');
    await expect(load_config(nonexistent)).rejects.toThrow('Config file not found');
  });

  it('loads openai provider config', async () => {
    const configPath = resolve(TEST_DIR, 'config-openai.yaml');
    await writeFile(configPath, `
provider: openai
openai:
  api_key: sk-openaikey
  base_url: https://api.openai.com/v1
  model: gpt-4o
`);
    const config = await load_config(configPath);
    expect(config.provider).toBe('openai');
    expect(config.openai?.model).toBe('gpt-4o');
  });

  it('loads tools and approval config', async () => {
    const configPath = resolve(TEST_DIR, 'config-full.yaml');
    await writeFile(configPath, `
provider: anthropic
anthropic:
  api_key: sk-ant-key
tools:
  run_shell:
    allowed_commands:
      - npm
      - git
approval:
  auto_approve_safe: true
  timeout_seconds: 300
`);
    const config = await load_config(configPath);
    expect(config.tools?.run_shell?.allowed_commands).toContain('npm');
    expect(config.approval?.auto_approve_safe).toBe(true);
  });

  it('loads learning config with batch_turns and reminder', async () => {
    const configPath = resolve(TEST_DIR, 'config-learning.yaml');
    await writeFile(configPath, `
provider: anthropic
anthropic:
  api_key: sk-ant-key
learning:
  enabled: true
  batch_turns: 20
  min_confidence: 0.8
  reminder:
    enabled: true
    max_per_session: 2
`);
    const config = await load_config(configPath);
    expect(config.learning?.batch_turns).toBe(20);
    expect(config.learning?.min_confidence).toBe(0.8);
    expect(config.learning?.reminder?.max_per_session).toBe(2);
  });
});
