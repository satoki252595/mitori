import { describe, expect, test } from "bun:test";
import type { AnchoredItem, ReanchorReport } from "@mitori/anchor";
import type { Cite, Claim, ClaimId, DocIndex, IndexDelta, ThreadId } from "@mitori/core";
import { MIGRATION_ORDER } from "../contract.ts";
import { assembleAnchoredItems, distributeReanchor, migrationsFor } from "./index.ts";
import { claimReanchor, suggestionViews } from "./suggestions.ts";
import { citeLinks, fileBacklinks } from "./views.ts";

const cite = (path: string, start: number, end: number): Cite => ({ path, start, end, blob: `b-${path}`, snippet: "0000000000000000", precision: "exact" });
const claim = (id: string, cites: Cite[]): Claim =>
  ({
    id,
    block: "b_aaaaaaaa",
    kind: "behavior",
    quote: "q",
    cites,
    verdict: "verified",
    checks: { l0: true, l1: "pass", l2: true, checkedAt: "t" },
  }) as unknown as Claim;
const delta = (paths: string[], renames: { from: string; to: string }[] = []): IndexDelta =>
  ({
    changed: paths.map((path) => ({ path, oldBlob: "o", newBlob: "n" })),
    renames,
    bodyOnly: [],
    symbols: [],
    ifaceChanged: [],
    membershipChanged: [],
    factsChanged: false,
    factKinds: [],
    structureRefreshed: false,
  }) as unknown as IndexDelta;
const docOf = (claims: Claim[]) => ({ index: () => ({ claims: Object.fromEntries(claims.map((c) => [c.id, c])) }) as unknown as DocIndex });

describe("SRV-AT-08 DOMAIN_WIRING pure steps", () => {
  test("assembleAnchoredItems: claims with a changed cite (all their cites, id order), then threads of changed paths", () => {
    const doc = docOf([claim("cl_b", [cite("a.go", 1, 2), cite("z.go", 3, 4)]), claim("cl_a", [cite("a.go", 5, 6)]), claim("cl_c", [cite("x.go", 1, 1)])]);
    const items = assembleAnchoredItems(delta(["a.go"]), doc, [
      { id: "th_2" as ThreadId, code: cite("a.go", 9, 9) },
      { id: "th_1" as ThreadId, code: cite("b.go", 1, 1) },
      { id: "th_0" as ThreadId, code: null },
    ]);
    expect(items.map((i) => `${i.kind}:${i.owner}:${i.kind === "cite" ? i.index : "-"}`)).toEqual([
      "cite:cl_a:0",
      "cite:cl_b:0",
      "cite:cl_b:1",
      "thread:th_2:-",
    ]);
    expect(assembleAnchoredItems(delta([]), doc, [])).toEqual([]);
    expect(assembleAnchoredItems(delta([], [{ from: "x.go", to: "y.go" }]), doc, []).map((i) => i.owner)).toEqual(["cl_c"]);
  });

  test("distributeReanchor: moved cites keep order; overlap or outdated ⇒ stale; threads carry the new code member", () => {
    const items: AnchoredItem[] = [
      { kind: "cite", owner: "cl_a" as ClaimId, index: 0, cite: cite("a.go", 1, 2) },
      { kind: "cite", owner: "cl_a" as ClaimId, index: 1, cite: cite("b.go", 1, 2) },
      { kind: "cite", owner: "cl_b" as ClaimId, index: 0, cite: cite("a.go", 7, 8) },
      { kind: "thread", owner: "th_1" as ThreadId, anchor: { path: "a.go", start: 3, end: 3, blob: "o", snippet: "0" } as never },
    ];
    const r = (health: "ok" | "moved" | "outdated", anchor: object, overlapped = false) => ({
      result: { health, method: "diff", anchor, previous: anchor, confidence: 1 },
      overlapped,
      step: "S3",
    });
    const report = {
      results: [
        r("moved", cite("a.go", 3, 4)),
        r("ok", cite("b.go", 1, 2)),
        r("moved", cite("a.go", 9, 10), true),
        r("outdated", { path: "a.go", start: 5, end: 5 }),
      ],
      counts: { ok: 1, moved: 2, fuzzy: 0, outdated: 1 },
      mapped: ["a.go"],
      ms: 1,
    } as unknown as ReanchorReport;
    const out = distributeReanchor(items, report);
    expect(out.counts).toEqual({ ok: 1, moved: 2, fuzzy: 0, outdated: 1 });
    expect(out.claims.map((c) => [c.id, c.cites.map((x) => `${x.path}:${x.start}`), c.stale])).toEqual([
      ["cl_a", ["a.go:3", "b.go:1"], false],
      ["cl_b", ["a.go:9"], true],
    ]);
    expect(out.claims[1]?.checks.l2).toBe(false);
    // an outdated thread keeps its previous code member
    expect(out.threads).toEqual([
      {
        thread: "th_1",
        anchor: { primary: "code", code: items[3]?.kind === "thread" ? items[3].anchor : (null as never) },
        health: "outdated",
        method: "diff",
        overlapped: false,
        blockRewritten: false,
      },
    ]);
  });

  test("migrationsFor: MIGRATION_ORDER package order, then version; one database only", () => {
    for (const db of ["state", "workspace"] as const) {
      const list = migrationsFor(db);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((m) => m.db === db)).toBe(true);
      const order: readonly string[] = MIGRATION_ORDER[db];
      const keys = list.map((m) => [order.indexOf(m.pkg), m.version] as const);
      expect([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1])).toEqual(keys);
      expect(new Set<string>(list.map((m) => m.pkg))).toEqual(new Set<string>(order.filter((p) => list.some((m) => m.pkg === p))));
    }
    expect(migrationsFor("state").map((m) => m.pkg)).toContain("@mitori/agent");
    expect(new Set(migrationsFor("workspace").map((m) => m.pkg))).toEqual(
      new Set(["@mitori/server", "@mitori/indexer", "@mitori/doc", "@mitori/gen", "@mitori/loop"]),
    );
  });

  test("publishSuggestions inputs: ClaimReanchor buckets (outdated > overlapped > moved) and SuggestionView", () => {
    const items: AnchoredItem[] = [
      { kind: "cite", owner: "cl_m" as ClaimId, index: 0, cite: cite("a.go", 1, 2) },
      { kind: "cite", owner: "cl_o" as ClaimId, index: 0, cite: cite("a.go", 5, 6) },
      { kind: "cite", owner: "cl_x" as ClaimId, index: 0, cite: cite("a.go", 9, 9) },
    ];
    const r = (health: string, anchor: object, overlapped = false) => ({
      result: { health, method: "diff", anchor, previous: anchor, confidence: 1 },
      overlapped,
      step: "S3",
    });
    const report = {
      results: [r("moved", cite("a.go", 3, 4)), r("moved", cite("a.go", 7, 8), true), r("outdated", cite("a.go", 9, 9))],
      counts: {},
      mapped: [],
      ms: 0,
    } as unknown as ReanchorReport;
    const cr = claimReanchor(items, report);
    expect(cr.moved.map((m) => [m.claim, m.cites[0]?.start])).toEqual([["cl_m", 3]]);
    expect(cr.overlapped).toEqual(["cl_o" as ClaimId]);
    expect(cr.outdated).toEqual(["cl_x" as ClaimId]);
    const est = { id: "es_x" } as never;
    expect(
      suggestionViews(
        [{ id: "sg_1", section: "s6/a", reason: "iface_changed", rule: "R1", kind: "regen", prompt: "gen.module", blocks: [], estimate: est }] as never,
        ["a.go"],
        "t" as never,
      ),
    ).toEqual([{ id: "sg_1", section: "s6/a", reason: "iface_changed", kind: "regen", blocks: [], files: ["a.go"], estimate: est, createdAt: "t" }] as never);
  });
});

describe("LIVE-06 [[path:a-b]] cites in thread messages", () => {
  const ws = "ws_cccccccccccc" as never;
  test("a cite becomes a link to the code view; a single line has no range; bad paths and ranges stay as written", () => {
    expect(citeLinks(ws, "Fetch は再試行する [[internal/meta/fetch.go:46-61]]。")).toBe(
      "Fetch は再試行する [fetch.go:46-61](/w/ws_cccccccccccc/code/internal/meta/fetch.go#L46-L61)。",
    );
    expect(citeLinks(ws, "[[a.go:7]] と [[a.go:7-7]]")).toBe("[a.go:7](/w/ws_cccccccccccc/code/a.go#L7) と [a.go:7](/w/ws_cccccccccccc/code/a.go#L7)");
    expect(citeLinks(ws, "[[../etc/passwd:1-2]] [[a.go:9-3]] [[a.go:0-2]] [[no range]] [[x]]")).toBe(
      "[[../etc/passwd:1-2]] [[a.go:9-3]] [[a.go:0-2]] [[no range]] [[x]]",
    );
  });
});

describe("EX-07 code view backlinks", () => {
  test("a block citing the same file three times gives three distinct rows (no duplicate keys), the requested range first", () => {
    const cite = (start: number, end: number): Cite => ({
      path: "internal/server/server.go",
      start,
      end,
      blob: "b".repeat(40),
      snippet: "s".repeat(16),
      precision: "exact",
    });
    const claim = (id: string, cites: Cite[]) => ({ id, block: "b_aaaaaaaa", kind: "behavior", cites }) as unknown as Claim;
    const idx = {
      blocks: {
        b_aaaaaaaa: { section: "s6/server", claims: ["c_1", "c_2"] },
        b_bbbbbbbb: { section: "s3/flow", claims: ["c_3"] },
      },
      claims: { c_1: claim("c_1", [cite(127, 228), cite(425, 430)]), c_2: claim("c_2", [cite(449, 460), cite(127, 228)]), c_3: claim("c_3", [cite(323, 333)]) },
    } as unknown as DocIndex;
    const doc = { index: () => idx, blocksCiting: () => ["b_aaaaaaaa", "b_bbbbbbbb"] } as never;
    const rows = fileBacklinks(doc, "internal/server/server.go" as never, { start: 323, end: 333 });
    expect(rows.map((r) => `${r.block}:${r.start}-${r.end}`)).toEqual(["b_bbbbbbbb:323-333", "b_aaaaaaaa:127-228", "b_aaaaaaaa:425-430", "b_aaaaaaaa:449-460"]);
    expect(new Set(rows.map((r) => `${r.block}:${r.start}-${r.end}`)).size).toBe(rows.length);
  });
});
