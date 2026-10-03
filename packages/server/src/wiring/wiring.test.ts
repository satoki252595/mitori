import { describe, expect, test } from "bun:test";
import type { AnchoredItem, ReanchorReport } from "@mitori/anchor";
import type { Cite, Claim, ClaimId, DocIndex, IndexDelta, ThreadId } from "@mitori/core";
import { MIGRATION_ORDER } from "../contract.ts";
import { assembleAnchoredItems, distributeReanchor, migrationsFor } from "./index.ts";

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
});
