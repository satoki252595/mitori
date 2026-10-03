// The recorder of bench/measure/gen-real.ts over the scenario claude (0 tokens): every engine process is saved with its
// argv, CLAUDE_CODE_* env, stdin and stdout lines, and the daemon's run still completes.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenEstimate, GenRun, GenRunDetail } from "@mitori/core";
import { buildFixture } from "@mitori/testkit";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../../test/int/fake-claude.ts";
import { startInt } from "../../test/int/harness.ts";
import { recordingSpawner } from "./gen-real-record.ts";

const dir = mkdtempSync(join(tmpdir(), "mitori-rec-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("BENCH-GENREAL-01 recordingSpawner records every engine process of a generation run", async () => {
  const repo = await buildFixture("go-small");
  const int = await startInt({ spawner: recordingSpawner(dir, fakeClaude({ dtMs: 0 })), config: FAKE_CLAUDE_CONFIG });
  try {
    const { ws } = await int.open(repo.root);
    const est = await int.json<GenEstimate>("POST", `/ws/${ws}/gen/estimate`, { effort: "standard" });
    const run = await int.json<GenRun>("POST", `/ws/${ws}/gen/runs`, { estimateId: est.id, confirm: true });
    for (let i = 0; i < 600; i++) {
      const d = await int.json<GenRunDetail>("GET", `/ws/${ws}/gen/runs/${run.id}`);
      if (["done", "failed", "cancelled"].includes(d.run.state)) break;
      await Bun.sleep(50);
    }
    await Bun.sleep(200);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const rec = JSON.parse(readFileSync(join(dir, files[0] as string), "utf8")) as {
      argv: string[];
      env: Record<string, string>;
      stdin: string;
      out: [number, string][];
    };
    expect(rec.argv).toContain("stream-json");
    expect(Object.keys(rec.env)).toContain("CLAUDE_CODE_PROMPT_CACHE_TTL");
    expect(rec.stdin.startsWith('{"type":"user"')).toBe(true);
    expect(rec.out.some(([, l]) => l.includes('"type":"result"'))).toBe(true);
  } finally {
    await int.close();
    await repo.dispose();
  }
}, 60_000);
