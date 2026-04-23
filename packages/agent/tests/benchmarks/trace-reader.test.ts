import { describe, expect, it } from "vitest";

import { countRedundantReads, parseTraceEvents } from "../../../../benchmarks/scripts/utils/trace-reader.js";

describe("benchmark trace reader", () => {
  it("parses JSONL trace events", () => {
    const events = parseTraceEvents(
      [
        JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", run_id: "run-1", suite: "foundation", task_id: "task-1", event_type: "task_started" }),
        JSON.stringify({ ts: "2026-01-01T00:00:01.000Z", run_id: "run-1", suite: "foundation", task_id: "task-1", event_type: "file_read", file_path: "src/main.py" }),
      ].join("\n"),
    );

    expect(events).toHaveLength(2);
    expect(events[1]?.event_type).toBe("file_read");
  });

  it("counts redundant file reads after the first read", () => {
    const redundantReads = countRedundantReads([
      { event_type: "file_read", file_path: "src/main.py" },
      { event_type: "file_read", file_path: "src/main.py" },
      { event_type: "file_read", file_path: "src/utils.py" },
      { event_type: "tool_call", tool_name: "Read" },
      { event_type: "file_read", file_path: "src/main.py" },
    ]);

    expect(redundantReads).toBe(2);
  });
});
