import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HREFS, type SymbolEntry, type WorkspaceKey } from "@mitori/core";
import { SEARCH_LIMITS } from "../contract.ts";
import { corpusDir, FIXTURES, loadRepo } from "../structure/test/corpus.ts";
import { memDb } from "../structure/test/db.ts";
import { runPipeline, xxh3 } from "../structure/test/pipeline.ts";
import { symbolIndex } from "./find.ts";
import { fallbackSearch, search, writeSearchIndex } from "./fts.ts";
import { paletteDigest, paletteItems } from "./palette.ts";
import { searchRows } from "./rows.ts";

const WS = "ws_000000000000" as WorkspaceKey;

async function indexed(root: string) {
  const p = runPipeline((await loadRepo(root)).input);
  const rows = searchRows(p.input.files, p.structure, p.facts.facts);
  const db = memDb();
  await writeSearchIndex(db, rows);
  return { p, rows, db };
}

describe("IDX-U search (spec §8): FTS5 trigram + fallback", () => {
  test("rows cover files, exported symbols, modules and facts; FTS hits carry HREFS and escaped snippets", async () => {
    const { p, rows, db } = await indexed(join(FIXTURES, "ts-small"));
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(["file", "symbol", "module", "fact"]));
    expect(rows.filter((r) => r.kind === "symbol").every((r) => p.input.files.some((f) => f.symbols.some((s) => s.key === r.id && s.exported)))).toBe(true);
    const o = { ws: WS, fallback: rows, ftsReady: true };
    const repo = search(db, "BookRepo", ["symbol"], 5, o);
    expect(repo[0]).toMatchObject({ kind: "symbol", id: "src/db/repo.ts#BookRepo", label: "BookRepo", href: HREFS.code(WS, "src/db/repo.ts", 10) });
    expect(repo[0]?.snippet).toContain("<mark>BookRepo</mark>");
    const route = search(db, "/api/books", ["fact"], 10, o);
    expect(route.some((h) => h.label === "GET /api/books" && h.href === HREFS.code(WS, "src/http/routes.ts", 24))).toBe(true);
    const file = search(db, "metadata", ["file"], 5, o);
    expect(file.find((h) => h.id === "src/services/metadata.ts")).toMatchObject({ kind: "file", href: HREFS.code(WS, "src/services/metadata.ts") });
    const mod = p.structure.modules[0];
    const m = search(db, mod?.name.slice(0, 5) ?? "", ["module"], 5, o);
    expect(m[0]?.href).toBe(HREFS.doc(WS, `s6/${mod?.slug}`));
    // a module is also found by its representative symbols (spec §8 module row body)
    const owner = p.structure.moduleOf.get("src/db/repo.ts");
    expect(search(db, "BookRepo", ["module"], 5, o).map((h) => h.id)).toContain(owner as string);
    // scores are descending; snippets never carry raw markup from the source text
    for (const hits of [repo, route, file])
      for (let i = 1; i < hits.length; i++) expect((hits[i - 1] as { score: number }).score).toBeGreaterThanOrEqual((hits[i] as { score: number }).score);
    expect(search(db, `"<script>`, ["file", "symbol"], 5, o).every((h) => !(h.snippet ?? "").includes("<script>"))).toBe(true);
  });

  test("1–2 character queries and the pre-FTS window use the in-memory fallback", async () => {
    const { rows, db } = await indexed(join(FIXTURES, "ts-small"));
    const short = search(db, "cs", ["file"], 5, { ws: WS, fallback: rows, ftsReady: true });
    expect(short[0]?.id).toBe("src/lib/csv.ts");
    const pre = search(db, "BookList", ["symbol", "file"], 5, { ws: WS, fallback: rows, ftsReady: false });
    expect(pre.map((h) => h.id)).toEqual(fallbackSearch("BookList", ["symbol", "file"], 5, { ws: WS, fallback: rows }).map((h) => h.id));
    expect(pre[0]?.label).toBe("BookList");
  });
});

describe("IDX-U palette items (spec §8 R1)", () => {
  test("modules, included files and exported symbols with core HREFS; digest tracks the sources only", async () => {
    const p = runPipeline((await loadRepo(join(FIXTURES, "ts-small"))).input);
    const items = paletteItems(WS, p.input.files, p.structure);
    expect(items.filter((i) => i.k === "m")).toHaveLength(p.structure.modules.length);
    const m = items.find((i) => i.k === "m");
    expect(m?.h).toBe(HREFS.doc(WS, `s6/${m?.s}`));
    expect(items.find((i) => i.k === "f" && i.i === "src/index.ts")).toEqual({
      k: "f",
      i: "src/index.ts",
      l: "index.ts",
      s: "src",
      h: HREFS.code(WS, "src/index.ts"),
    });
    expect(items.find((i) => i.k === "y" && i.i === "src/index.ts#main")?.h).toBe(HREFS.code(WS, "src/index.ts", 12, 18));
    expect(items.some((i) => i.k === "y" && i.i === "src/index.ts#portFlag")).toBe(false); // not exported
    expect(items.some((i) => i.k === "f" && i.i === "dist/app.min.js")).toBe(false); // excluded
    expect(items.length).toBeLessThanOrEqual(SEARCH_LIMITS.paletteTotal);
    const d = paletteDigest(p.input.files, p.structure, xxh3);
    expect(paletteDigest(p.input.files, p.structure, xxh3)).toBe(d);
    const touched = p.input.files.map((f) => (f.path === "src/index.ts" ? { ...f, blob: "other" } : f));
    expect(paletteDigest(touched, p.structure, xxh3)).not.toBe(d);
  });
});

describe("IDX-U findSymbols (spec §8)", () => {
  const sym = (name: string, path = "a.ts", exported = true): SymbolEntry => ({
    key: `${path}#${name}`,
    path,
    blob: "b",
    kind: "function",
    name,
    qualname: name,
    start: 1,
    end: 1,
    signature: name,
    sigHash: "0",
    bodyHash: "0",
    exported,
  });
  test("exact > prefix > camel initials > substring > subsequence; exported and rank break ties", () => {
    const idx = symbolIndex(
      [sym("parseArgs"), sym("parse"), sym("parseArgsExtra"), sym("reparse"), sym("pxaxrxsxe"), sym("printArray"), sym("parse", "b.ts", false)],
      new Map([
        ["a.ts", 0.5],
        ["b.ts", 0.1],
      ]),
    );
    expect(idx.find("parse", 10).map((s) => s.key)).toEqual([
      "a.ts#parse",
      "b.ts#parse",
      "a.ts#parseArgs",
      "a.ts#parseArgsExtra",
      "a.ts#reparse",
      "a.ts#pxaxrxsxe",
    ]);
    expect(idx.find("pa", 4).map((s) => s.key)).toEqual(["a.ts#parse", "a.ts#parseArgs", "a.ts#parseArgsExtra", "b.ts#parse"]);
    expect(idx.find("pae", 2).map((s) => s.name)).toEqual(["parseArgsExtra", "parse"]);
    expect(idx.find("", 5)).toEqual([]);
  });
});

const crit = corpusDir("crit");

describe.skipIf(!crit)("IDX-AT search latency on crit", () => {
  test("search() ≤ 1 ms per query (target; limit 5 ms) over the crit rows", async () => {
    const { rows, db } = await indexed(crit as string);
    const o = { ws: WS, fallback: rows, ftsReady: true };
    const queries = [
      "session",
      "handleShare",
      "diff",
      "config",
      "review",
      "comment",
      "api/share",
      "Server",
      "parse",
      "token",
      "git",
      "watch",
      "CRIT_PORT",
      "render",
      "live",
    ];
    for (const q of queries) search(db, q, ["file", "symbol", "module", "fact"], 20, o); // warm statements
    const t0 = performance.now();
    let hits = 0;
    const rounds = 20;
    for (let r = 0; r < rounds; r++) for (const q of queries) hits += search(db, q, ["file", "symbol", "module", "fact"], 20, o).length;
    const per = (performance.now() - t0) / (rounds * queries.length);
    console.log(`[idx.search.ms] crit rows=${rows.length} per-query=${per.toFixed(3)}ms hits=${hits}`);
    expect(hits).toBeGreaterThan(0);
    // generous deadline; idx.search.ms (1 ms, limit 5) is the bench case of bench/idx.bench.ts
    expect(per).toBeLessThanOrEqual(25);
  }, 60_000);
});
