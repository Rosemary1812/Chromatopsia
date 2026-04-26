import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSelfLearningSkillConfig } from "../../../../benchmarks/scripts/self-learning-skill/config.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "self-learning-skill-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("self-learning-skill config loader", () => {
  it("loads the default config", async () => {
    const config = await loadSelfLearningSkillConfig();

    expect(config.suite).toBe("self-learning-skill");
    expect(config.paths.fixtures_root).toBe("benchmarks/fixtures/self-learning-skill");
    expect(config.scoring.phase_weights.reuse_effect).toBe(0.4);
  });

  it("rejects invalid configs", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "self-learning-skill.yaml");
    await fs.writeFile(configPath, "suite: foundation\n", "utf8");

    await expect(loadSelfLearningSkillConfig(configPath)).rejects.toThrow();
  });
});
