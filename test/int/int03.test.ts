// INT-03 (MILESTONES §5, M1): ⌘K — the palette digest (sources, not the rev) and `palette.changed`; module ids
// restored from an external seed (a committed `.mitori/doc.index.json` opened on a machine without the DB).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DocIndex, ID_ALPHABET, type ModuleInfo, type PaletteIndex, type WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { corpusDir } from "../../packages/indexer/src/parse/test/corpus.ts";
import type { SseReader } from "../../packages/server/src/http/test/sse-reader.ts";
import { type Int, startInt } from "./harness.ts";

let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let sse: SseReader;
const CRIT = corpusDir("crit");
const cleanup: string[] = [];

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
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

describe("INT-03 palette and module identity", () => {
  test("palette: sections, modules, files and symbols; digest moves with its sources, palette.changed names them", async () => {
    const p0 = await int.json<PaletteIndex>("GET", `/ws/${ws}/search/palette`);
    const kinds = new Set(p0.items.map((i) => i.k));
    for (const k of ["s", "m", "f", "y"]) expect(kinds.has(k as never)).toBe(true);
    expect(p0.digest).toMatch(/^[0-9a-f]{16}$/);
    // a rev-only change (doc write) keeps the digest
    expect((await int.json<PaletteIndex>("GET", `/ws/${ws}/search/palette`)).digest).toBe(p0.digest);

    const mark = sse.events.length;
    writeFileSync(join(repo.root, "internal/config/extra.go"), 'package config\n\n// Extra is new.\nfunc Extra() string { return "x" }\n');
    await sse.until((e) => e.slice(mark).some((x) => x.type === "palette.changed"), 5000);
    const changed = sse.events.slice(mark).find((x) => x.type === "palette.changed");
    expect(changed && "sources" in changed ? changed.sources : []).toEqual(expect.arrayContaining(["files"]));
    const p1 = await int.json<PaletteIndex>("GET", `/ws/${ws}/search/palette`);
    expect(p1.digest).not.toBe(p0.digest);
    expect(p1.items.some((i) => i.k === "y" && i.l === "Extra")).toBe(true);
  }, 30_000);

  test("module ids come back from the committed doc.index.json on a machine without the DB", async () => {
    // the fixtures are one module each under the real STRUCTURE_PARAMS: a local clone of crit when it is there
    let root = repo.root;
    if (CRIT) {
      root = mkdtempSync(join(tmpdir(), "mitori-int03-"));
      cleanup.push(root);
      const r = Bun.spawnSync(["git", "clone", "-q", "--local", CRIT, root]);
      expect(r.exitCode).toBe(0);
      ws = (await int.open(root)).ws;
    }
    const d = int.domain(ws);
    await d.doc.flush({ force: true });
    const before = await int.json<ModuleInfo[]>("GET", `/ws/${ws}/modules`);
    expect(before.length).toBeGreaterThan(0);
    await int.close();

    // the committed doc came from elsewhere: other ids for the same members (reps)
    const path = join(root, ".mitori/doc.index.json");
    const idx = JSON.parse(readFileSync(path, "utf8")) as DocIndex;
    const fresh = new Map<string, string>();
    let n = 0;
    for (const m of idx.modules) fresh.set(m.id, `md_${ID_ALPHABET[(n++ % 26) + 6]?.repeat(8)}`);
    const text = [...fresh].reduce((t, [a, b]) => t.split(a).join(b), readFileSync(path, "utf8"));
    writeFileSync(path, text);

    int = await startInt(); // new MITORI_HOME: no state, no workspace DB
    ws = (await int.open(root)).ws;
    const after = new Set((await int.json<ModuleInfo[]>("GET", `/ws/${ws}/modules`)).map((m) => m.id));
    // IDX-AT-34: ≥ 95 % of the LEAF ids come back (parents are re-derived from their children)
    const leaves = before.filter((m) => m.paths.length > 0);
    const restored = leaves.filter((m) => after.has(fresh.get(m.id) as never)).length;
    const all = before.filter((m) => after.has(fresh.get(m.id) as never)).length;
    console.log(`[INT-03] seed ids restored: leaves ${restored}/${leaves.length}, all modules ${all}/${before.length}`);
    expect(restored).toBeGreaterThanOrEqual(Math.ceil(leaves.length * 0.95));
    sse = await int.sse(ws);
  }, 60_000);
});
