import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRecordingGuard } from "./guard.ts";

describe("TK-HOME-04 recording spawn guard (counter agent.spawns.real)", () => {
  test("its shims refuse with 97 like the static ones and record each invocation", () => {
    const g = createRecordingGuard();
    try {
      for (const cli of ["claude", "codex"]) {
        const r = spawnSync(join(g.dir, cli), ["--model", "x"], { encoding: "utf8" });
        expect(r.status).toBe(97);
        expect(r.stderr).toContain("blocked in tests");
      }
      expect(g.hits()).toEqual(["claude --model x", "codex --model x"]);
    } finally {
      g.dispose();
    }
    expect(existsSync(g.dir)).toBe(false);
  });

  test("no invocation, no record", () => {
    const g = createRecordingGuard();
    expect(g.hits()).toEqual([]);
    g.dispose();
  });
});
