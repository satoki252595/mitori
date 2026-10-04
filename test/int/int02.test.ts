// INT-02 (MILESTONES §5, M1): file save → `index.changed` → ONE reanchor pass (claims + threads, W1) → claim
// updates and freshness in the SAME slot/rev (W2) → `doc.freshness` within 50 ms of the save (watcher 5 ms leading
// edge + indexer update + anchor cascade + slot). Threads: the loop part is pending (WP-08b), so the thread half of
// the slot carries no updates; the pure distribution is covered in packages/server/src/wiring/wiring.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SseEvent, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import type { SseReader } from "../../packages/server/src/http/test/sse-reader.ts";
import { type Int, startInt } from "./harness.ts";

const FILE = "internal/config/config.go";
let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let sse: SseReader;

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt();
  ws = (await int.open(repo.root)).ws;
  sse = await int.sse(ws);
  await sse.until((e) => e.some((x) => x.type === "hello"));
}, 60_000);
afterAll(async () => {
  sse?.close();
  await int?.close();
  await repo?.dispose();
});

const after = (from: number) => sse.events.slice(from);
const write = (rel: string, text: string) => writeFileSync(join(repo.root, rel), text);

describe("INT-02 save → reanchor → doc.freshness", () => {
  test("a human-cited claim moves with an insertion above it, then goes stale on an edit inside it within 50 ms", async () => {
    const d = int.domain(ws);
    const block = d.doc.section("s4")?.blocks.find((b) => b.kind !== "heading");
    if (!block) throw new Error("no s4 block");
    await d.doc.editBlock(block.id, block.hash, "設定は環境変数から読む。（[config.go:19](../../internal/config/config.go#L19-L30)）", "human");
    const [claim] = d.doc.claims(block.id);
    expect(claim?.cites[0]).toMatchObject({ path: FILE, start: 19, end: 30 });

    // warm-up: the first update after a scan starts the parse Worker
    let mark = sse.events.length;
    write("README.md", `${readFileSync(join(repo.root, "README.md"), "utf8")}\nwarm-up\n`);
    await sse.until((e) => e.slice(mark).some((x) => x.type === "index.changed"), 5000);

    // (1) two lines inserted above the range: the cite moves (19-30 → 21-32), the claim stays fresh
    const original = readFileSync(join(repo.root, FILE), "utf8");
    mark = sse.events.length;
    write(FILE, `// moved\n// down\n${original}`);
    await sse.until((e) => e.slice(mark).some((x) => x.type === "doc.claims"), 5000);
    expect(d.doc.claims(block.id)[0]?.cites[0]).toMatchObject({ path: FILE, start: 21, end: 32 });
    expect(d.doc.block(block.id)?.freshness).not.toBe("stale");

    // (2) a line inside the range changes: stale, and the claim update + freshness share one rev (W2)
    await Bun.sleep(50);
    mark = sse.events.length;
    const t0 = performance.now();
    write(FILE, `// moved\n// down\n${original.replace('level = "info"', 'level = "warn"')}`);
    await sse.until((e) => e.slice(mark).some((x) => x.type === "doc.freshness"), 5000);
    const fresh = after(mark).find((x): x is Extract<SseEvent, { type: "doc.freshness" }> => x.type === "doc.freshness");
    const i = sse.events.indexOf(fresh as SseEvent);
    const ms = (sse.times[i] ?? Number.POSITIVE_INFINITY) - t0;
    console.log(`[INT-02] save → doc.freshness ${ms.toFixed(1)} ms (budget 50)`);
    expect(fresh?.blocks).toEqual([block.id]);
    expect(fresh?.freshness).toBe("stale");
    const claims = after(mark).find((x) => x.type === "doc.claims");
    expect(claims?.rev).toBe(fresh?.rev);
    expect(after(mark).some((x) => x.type === "index.changed")).toBe(true);
    expect(d.doc.claims(block.id)[0]?.verdict).toBe("stale");
    // generous deadline: the 50 ms (p50) budget of this chain is the bench case idx.freshness (bench/idx.bench.ts)
    expect(ms).toBeLessThan(2_000);
  }, 30_000);
});
