// UX-FIX-01..07 (CR ux-F1): code targets of a Fix on a doc anchor — (a) the anchored claim's cites are the automatic
// targets, (b) without cites the block's own code references in the selected row, exact symbol names and full-text hits
// are offered as candidates, (c) nothing when nothing matches. Never a path the router could not write.
import { describe, expect, test } from "bun:test";
import type { Anchor, Claim, FileEntry, SearchHit, SymbolEntry } from "@mitori/core";
import { mdPlain, nameLike, refsOf, resolveCodeTargets, selectedLines, type TargetDeps, termsOf } from "./targets.ts";

const file = (path: string, lines: number, extra: Partial<FileEntry> = {}): FileEntry => ({
  path,
  blob: "b".repeat(40),
  size: lines * 30,
  lang: "go",
  class: "source",
  lines,
  loc: lines,
  tokensEst: lines * 10,
  ...extra,
});
const sym = (path: string, qualname: string, start: number, end: number): SymbolEntry =>
  ({
    key: `${path}#${qualname}`,
    path,
    blob: "b".repeat(40),
    kind: "function",
    name: qualname.split(".").pop() as string,
    qualname,
    start,
    end,
    signature: "",
    sigHash: "",
    bodyHash: "",
    exported: true,
  }) as SymbolEntry;

const FILES = [
  file("internal/config/config.go", 38),
  file("internal/meta/fetch.go", 95),
  file("internal/server/server.go", 120),
  file("Makefile", 14, { lang: "generic" }),
  file("secrets/prod.env", 3, { excluded: "secret" }),
  file(".env", 3),
];
const SYMS = [
  sym("internal/config/config.go", "Load", 19, 38),
  sym("internal/meta/fetch.go", "Client.Fetch", 46, 61),
  sym("internal/meta/fetch.go", "Client.fetchOnce", 63, 89),
  sym("internal/server/server.go", "Server.listBooks", 40, 58),
  sym("internal/server/server.go", "Server", 10, 120),
];

const ENV_TABLE = [
  "| 名前 | 既定値 | 読む場所 |",
  "|---|---|---|",
  "| `DATABASE_URL` | なし | `internal/config/config.go:25` |",
  "| `PORT` | あり | `internal/config/config.go:20` |",
  "| `TSUNDOKU_API_TOKEN` | なし | `internal/config/config.go:36` |",
].join("\n");
const ENV_TEXT =
  "名前 既定値 読む場所 DATABASE_URL なし internal/config/config.go:25 PORT あり internal/config/config.go:20 TSUNDOKU_API_TOKEN なし internal/config/config.go:36";

const PROSE = "Fetch は失敗した取得を正確に 1 回だけ再試行する。";
const claim = (id: string, quote: string, cites: { path: string; start: number; end: number }[]): Claim =>
  ({
    id,
    block: "b_prose",
    kind: "behavior",
    quote,
    cites: cites.map((c) => ({ ...c, blob: "b".repeat(40), snippet: "0", precision: "exact" })),
    verdict: "verified",
    checks: { l0: true, l1: "pass", l2: true },
  }) as unknown as Claim;

function deps(over: { claims?: Claim[]; hits?: Record<string, SearchHit[]>; deny?: string[] } = {}): TargetDeps {
  const blocks: Record<string, { md: string; text: string }> = {
    b_env: { md: ENV_TABLE, text: ENV_TEXT },
    b_prose: { md: PROSE, text: PROSE },
    b_empty: { md: "この節はまだ生成されていません。", text: "この節はまだ生成されていません。" },
  };
  return {
    deny: over.deny ?? ["**/.env", "**/.env.*"],
    doc: {
      block: (id) => (blocks[id] ? ({ id, md: blocks[id]?.md } as never) : null),
      blockText: (id) => blocks[id]?.text ?? null,
      claims: (id) => (id === "b_prose" ? (over.claims ?? []) : []),
    },
    indexer: {
      file: (p) => FILES.find((f) => f.path === p) ?? null,
      enclosingSymbol: (p, s, e) =>
        SYMS.filter((x) => x.path === p && x.start <= s && x.end >= e).sort((a, b) => a.end - a.start - (b.end - b.start))[0] ?? null,
      symbols: (p) => SYMS.filter((x) => x.path === p),
      symbol: (k) => SYMS.find((x) => x.key === k) ?? null,
      findSymbols: (q) => SYMS.filter((x) => x.name.toLowerCase().includes(q.toLowerCase())),
      search: (q) => over.hits?.[q] ?? [],
    },
  };
}
const docAnchor = (block: string, claimId?: string): Anchor =>
  ({ primary: "doc", doc: { block, blockHash: "h", ...(claimId ? { claim: claimId } : {}) } }) as unknown as Anchor;

describe("code targets (CR ux-F1)", () => {
  test("UX-FIX-01 (a): the anchored claim's cites are the automatic targets — merged per file, labelled, with the symbol", () => {
    const claims = [
      claim("c_1", "Fetch は失敗した取得を正確に 1 回だけ再試行する", [
        { path: "internal/meta/fetch.go", start: 46, end: 61 },
        { path: "internal/meta/fetch.go", start: 55, end: 70 },
      ]),
      claim("c_2", "other", [{ path: "internal/server/server.go", start: 40, end: 58 }]),
    ];
    const r = resolveCodeTargets(deps({ claims }), { anchor: docAnchor("b_prose", "c_1"), selStart: 0, selEnd: 5 });
    expect(r.cited).toEqual([{ path: "internal/meta/fetch.go", start: 46, end: 70, label: "fetch.go:46-70", source: "cite", tokens: 250 }]);
    // without a bound claim: every cite of the block (= the router's write scope for this anchor, loop spec §3.2)
    const all = resolveCodeTargets(deps({ claims }), { anchor: docAnchor("b_prose") });
    expect(all.cited.map((t) => t.label)).toEqual(["fetch.go:46-70", "server.go:40-58"]);
    expect(all.cited[1]?.symbol).toBe("Server.listBooks");
    // a candidate never repeats a cited range
    expect(all.candidates.some((c) => c.path === "internal/meta/fetch.go" && c.start <= 70 && c.end >= 46)).toBe(false);
  });

  test("UX-FIX-02 (b): a static facts row offers ITS code reference, widened to the enclosing symbol — not the other rows'", () => {
    const at = ENV_TEXT.indexOf("TSUNDOKU_API_TOKEN");
    const r = resolveCodeTargets(deps(), { anchor: docAnchor("b_env"), selStart: at, selEnd: at + "TSUNDOKU_API_TOKEN".length });
    expect(r.cited).toEqual([]);
    expect(r.candidates[0]).toEqual({
      path: "internal/config/config.go",
      start: 19,
      end: 38,
      label: "config.go:19-38",
      symbol: "Load",
      source: "ref",
      tokens: 200,
      match: "internal/config/config.go:36",
    });
    // the PORT row resolves to its own line (same file, same symbol ⇒ the same range, offered once)
    const p = ENV_TEXT.indexOf("PORT");
    const rp = resolveCodeTargets(deps(), { anchor: docAnchor("b_env"), selStart: p, selEnd: p + 4 });
    expect(rp.candidates.map((t) => t.match)).toEqual(["internal/config/config.go:20"]);
  });

  test("UX-FIX-03 (b): names in the request find exact symbols; full-text hits follow; distinct files first; deny / secret never", () => {
    const hits: Record<string, SearchHit[]> = {
      TSUNDOKU_API_TOKEN: [{ kind: "fact", id: "env:x", label: "TSUNDOKU_API_TOKEN", sub: "internal/config/config.go:36", score: 1, href: "" }],
      fetchOnce: [{ kind: "fact", id: "env:y", label: "SECRET", sub: "secrets/prod.env:1", score: 1, href: "" }],
    };
    const r = resolveCodeTargets(deps({ hits }), {
      anchor: docAnchor("b_empty"),
      selStart: 0,
      selEnd: 3,
      text: "TSUNDOKU_API_TOKEN を必須にして、fetchOnce の再試行もそろえる。.env は触らない",
    });
    expect(r.candidates.map((t) => [t.label, t.source, t.match])).toEqual([
      ["fetch.go:63-89", "symbol", "fetchOnce"],
      ["config.go:19-38", "search", "TSUNDOKU_API_TOKEN"],
    ]);
  });

  test("UX-FIX-04 (c): nothing to point at ⇒ no target at all (the Composer shows how to point at code)", () => {
    const r = resolveCodeTargets(deps(), { anchor: docAnchor("b_empty"), selStart: 0, selEnd: 4, text: "もっと分かりやすくして" });
    expect(r).toEqual({ cited: [], candidates: [] });
  });

  test("UX-FIX-05: a symbol reference `path#Qual.name` and a GitHub-style link resolve to their ranges", () => {
    expect(refsOf("| GET | `/api/books` | `internal/server/server.go#Server.listBooks` | [x](internal/meta/fetch.go#L46-L61) |")).toEqual([
      "/api/books",
      "internal/server/server.go#Server.listBooks",
      "internal/meta/fetch.go:46-61",
    ]);
  });

  test("UX-FIX-06: the selected line is the k-th occurrence (the same word twice in a table picks its own row)", () => {
    const md = "| a | `x.go:1` |\n| a | `y.go:2` |";
    const text = "a x.go:1 a y.go:2";
    expect(selectedLines(md, text, 9, 10)).toEqual(["| a | `y.go:2` |"]);
    expect(selectedLines(md, text, 0, 1)).toEqual(["| a | `x.go:1` |"]);
    expect(selectedLines(md, text, 0, text.length)).toEqual(md.split("\n"));
    expect(mdPlain("- **`Load`** reads [env](a.go#L1)")).toBe("Load reads env");
  });

  test("UX-FIX-07: terms are NAMES of the selection first, then of the request — plain English words are not names", () => {
    expect(termsOf("TSUNDOKU_API_TOKEN", "make the retry count configurable via Client.Fetch 再試行回数")).toEqual([
      "TSUNDOKU_API_TOKEN",
      "Client.Fetch",
      "再試行回数",
      "再試行",
    ]);
    expect(termsOf("", "再試行回数を設定で変える")).toEqual(["再試行回数", "再試行"]);
    // crit, measured: `repo` / `agent` / `auth` matched dozens of fields; `agent_cmd` is the name that matters
    expect(termsOf("crit auth", "agent_cmd を repo 設定でも上書きできるように")).toEqual(["agent_cmd"]);
    // backticks make a plain word a name; a selected code reference is not split into names
    expect(termsOf("", "`story` の生成を速く")).toEqual(["story"]);
    expect(termsOf("cmd/crit/main.go:21", "")).toEqual([]);
    expect(nameLike("Fetch")).toBe(true);
    expect(nameLike("fetchOnce")).toBe(true);
    expect(nameLike("repo")).toBe(false);
  });

  test("UX-FIX-08: tests come after the code they test, unless the request talks about tests", () => {
    const d = deps();
    const all = [...SYMS, sym("internal/meta/fetch_test.go", "TestFetch", 1, 30)];
    d.indexer.findSymbols = (q) => all.filter((x) => x.name.toLowerCase() === q.toLowerCase() || x.name === `Test${q}`);
    d.indexer.search = (q) => (q === "Fetch" ? [{ kind: "symbol", id: "internal/meta/fetch_test.go#TestFetch", label: "TestFetch", score: 1, href: "" }] : []);
    d.indexer.symbol = (k) => all.find((x) => x.key === k) ?? null;
    FILES.push(file("internal/meta/fetch_test.go", 40, { class: "test" }));
    const r = resolveCodeTargets(d, { anchor: docAnchor("b_empty"), selStart: 0, selEnd: 3, text: "Fetch を速く" });
    expect(r.candidates.map((t) => t.path)).toEqual(["internal/meta/fetch.go", "internal/meta/fetch_test.go"]);
    const t = resolveCodeTargets(d, { anchor: docAnchor("b_empty"), selStart: 0, selEnd: 3, text: "Fetch のテストを足す" });
    expect(t.candidates.map((x) => x.source)).toEqual(["symbol", "search"]);
    FILES.pop();
  });

  test("the limit caps the candidates (default 4, at most 8)", () => {
    const md = Array.from({ length: 10 }, (_, i) => `- \`internal/server/server.go:${10 + i * 11}\``).join("\n");
    const d = deps();
    d.doc.block = () => ({ id: "b_list", md }) as never;
    d.doc.blockText = () => "x";
    const r = resolveCodeTargets(d, { anchor: docAnchor("b_list"), limit: 20 });
    expect(r.candidates.length).toBeLessThanOrEqual(8);
    expect(resolveCodeTargets(d, { anchor: docAnchor("b_list") }).candidates.length).toBeLessThanOrEqual(4);
  });
});
