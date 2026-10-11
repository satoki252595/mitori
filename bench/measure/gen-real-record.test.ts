import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnSpec } from "@mitori/agent";
import { createFakeSpawner } from "../../packages/agent/src/testing.ts";
import { recordingSpawner } from "./gen-real-record.ts";

test("live probe native call cap allows detection and refuses a repair before spawning it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mitori-native-call-cap-"));
  try {
    const inner = createFakeSpawner().script(() => true, { stdout: [] });
    const spawner = recordingSpawner(dir, inner, 1);
    const spec: SpawnSpec = { command: "codex", argv: ["--version"], env: {}, cwd: dir, stdin: "", keepStdinOpen: false, timeoutMs: 1000, processGroup: true };
    await spawner.spawn(spec).exited;
    const first = spawner.spawn({ ...spec, argv: ["exec", "--json"] });
    await first.exited;
    expect(() => spawner.spawn({ ...spec, argv: ["exec", "--json"] })).toThrow("native call limit reached before spawn");
    expect(inner.calls.map((c) => c.argv)).toEqual([["--version"], ["exec", "--json"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
