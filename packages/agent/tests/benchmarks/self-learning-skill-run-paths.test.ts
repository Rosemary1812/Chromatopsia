import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SelfLearningSkillTraceWriter } from "../../../../benchmarks/scripts/self-learning-skill/trace.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "self-learning-skill-trace-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe("self-learning-skill trace writer", () => {
  it("creates parent directories and writes JSONL events", async () => {
    const dir = await makeTempDir();
    const tracePath = path.join(dir, "case-a", "traces", "learning.jsonl");
    const writer = new SelfLearningSkillTraceWriter(tracePath);

    await writer.write({
      ts: "2026-01-01T00:00:00.000Z",
      run_id: "run-1",
      suite: "self-learning-skill",
      case_id: "case-a",
      phase: "learning_generation",
      event_type: "case_prepared",
    });

    const raw = await fs.readFile(tracePath, "utf8");
    expect(raw.trim()).toContain('"event_type":"case_prepared"');
  });
});
