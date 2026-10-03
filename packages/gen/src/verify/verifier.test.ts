import { describe, expect, test } from "bun:test";
import type { Claim, ClaimChecks, ClaimId } from "@mitori/core";
import type { ClaimSpan } from "@mitori/doc";
import { fakeAnchors } from "../test/fake-anchor.ts";
import { createFakeIndexer } from "../test/fake-indexer.ts";
import { testClock, testHasher, testMetrics } from "../test/ports.ts";
import { sampleRepo } from "../test/repo.ts";
import { computeVerdict, extractIdentifiers } from "./index.ts";
import { l1, namesCitedFile } from "./l1.ts";
import { createVerifier } from "./verifier.ts";

const hasher = testHasher();
const span = (identifiers: string[]): ClaimSpan => ({ n: 1, start: 0, end: 1, quote: "q", identifiers });
const checks = (o: Partial<ClaimChecks>): ClaimChecks => ({ l0: true, l1: "pass", l2: true, checkedAt: "2026-10-03T00:00:00.000Z", ...o });

function setup() {
  const indexer = createFakeIndexer(sampleRepo(), hasher);
  const metrics = testMetrics();
  const v = createVerifier({ indexer, anchors: fakeAnchors(hasher), hasher, clock: testClock(), metrics });
  return { indexer, v, metrics };
}

describe("GEN-U-062 L1: a backticked path naming a cited file is satisfied by the cite", () => {
  const lines = ['it("accepts every language the UI offers", () => {', "  expect(isLang(x)).toBe(true);", "});"];
  test("path, /-suffix and containing directory pass; another file, a command or a bare word does not", () => {
    const paths = ["lib/i18n.test.ts", "internal/session/store.go"];
    for (const ok of ["lib/i18n.test.ts", "./lib/i18n.test.ts", "i18n.test.ts", "session/store.go", "internal/session", "lib/"])
      expect(namesCitedFile(ok, paths)).toBe(true);
    for (const no of ["lib/i18n.ts", "internal/diff", "crit install", "isLang", "st", "lib/i18n.test.tsx"]) expect(namesCitedFile(no, paths)).toBe(false);
  });

  test("a bare name equal to a cited file's stem names that file (real run 2026-10-04: `layout` citing app/layout.tsx)", () => {
    expect(namesCitedFile("layout", ["app/layout.tsx"])).toBe(true);
    expect(namesCitedFile("Editor", ["app/Editor.test.tsx"])).toBe(true);
    expect(namesCitedFile("editor", ["app/Editor.tsx"])).toBe(false);
    expect(namesCitedFile("app", ["app/layout.tsx"])).toBe(false);
  });

  test('m3e-canvas: "`lib/i18n.test.ts` は `isLang` が…" citing lib/i18n.test.ts:1 passes; without the path it does not change', () => {
    const w = { path: "lib/i18n.test.ts", lines, start: 1, end: 1 };
    expect(l1(["lib/i18n.test.ts", "isLang"], [w])).toBe("pass");
    expect(l1(["lib/i18n.test.ts", "isLang"], [{ ...w, path: "lib/other.ts" }])).toBe("fail");
    expect(l1(["lib/i18n.test.ts", "isLang"], [{ lines, start: 1, end: 1 }])).toBe("fail");
    expect(l1(["missingName"], [w])).toBe("fail");
  });
});

describe("AC-13 computeVerdict truth table (§7.2 + R1 cited)", () => {
  test("rows in priority order", () => {
    expect(computeVerdict({ checks: checks({ l0: false }), cites: 1, anyStale: false, lock: "human-verified" })).toBe("human-verified");
    expect(computeVerdict({ checks: checks({}), cites: 1, anyStale: true })).toBe("stale");
    expect(computeVerdict({ checks: checks({ l2: false }), cites: 1, anyStale: false })).toBe("stale");
    expect(computeVerdict({ checks: checks({ l0: false }), cites: 1, anyStale: false })).toBe("unsupported");
    expect(computeVerdict({ checks: checks({ l3: "U" }), cites: 1, anyStale: false })).toBe("unsupported");
    expect(computeVerdict({ checks: checks({ l1: "vacuous" }), cites: 0, anyStale: false })).toBe("inferred");
    expect(computeVerdict({ checks: checks({ l1: "fail" }), cites: 1, anyStale: false })).toBe("inferred");
    expect(computeVerdict({ checks: checks({ l1: "fail", l3: "S" }), cites: 1, anyStale: false })).toBe("verified");
    expect(computeVerdict({ checks: checks({ l3: "P" }), cites: 1, anyStale: false })).toBe("inferred");
    expect(computeVerdict({ checks: checks({ l1: "vacuous" }), cites: 1, anyStale: false })).toBe("cited");
    expect(computeVerdict({ checks: checks({ l1: "vacuous", l3: "S" }), cites: 1, anyStale: false })).toBe("verified");
    expect(computeVerdict({ checks: checks({}), cites: 2, anyStale: false, lock: "human-edited" })).toBe("verified");
  });
});

describe("extractIdentifiers", () => {
  test("backticked spans of the Markdown source", () => {
    expect(extractIdentifiers("`Store.Get` は `ErrExpired` を返す")).toEqual(["Store.Get", "ErrExpired"]);
    expect(extractIdentifiers("識別子なし")).toEqual([]);
  });
});

describe("GEN-U-030 stamp: blob, smallest enclosing symbol and snippet come from the index", () => {
  test("cites are stamped server-side", async () => {
    const { indexer, v } = setup();
    const r = await v.stamp([{ path: "src/session/store.ts", start: 10, end: 15 }], span(["get"]), indexer.snapshot()?.indexDigest ?? "");
    expect(r.cites).toEqual([
      {
        path: "src/session/store.ts",
        start: 10,
        end: 15,
        blob: indexer.currentBlob("src/session/store.ts") as string,
        symbol: "src/session/store.ts#Store.get",
        snippet: fakeAnchors(hasher).codeAnchor("src/session/store.ts", 10, 15, (await indexer.currentText("src/session/store.ts")) ?? "", "x").snippet,
        precision: "exact",
      },
    ]);
    expect(r.checks).toMatchObject({ l0: true, l0Raw: true, l1: "pass", l2: true });
  });

  test("W04 clamp / swap are applied and recorded; l0Raw keeps the raw result", async () => {
    const { v } = setup();
    const clamp = await v.stamp([{ path: "src/auth/login.ts", start: 3, end: 9 }], span(["login"]));
    expect(clamp.cites[0]?.end).toBe(7);
    expect(clamp.checks).toMatchObject({ l0: true, l0Raw: false, repaired: ["clamp"] });
    const swap = await v.stamp([{ path: "src/auth/login.ts", start: 5, end: 3 }], span(["login"]));
    expect([swap.cites[0]?.start, swap.cites[0]?.end]).toEqual([3, 5]);
    expect(swap.checks.repaired).toEqual(["swap"]);
    const gone = await v.stamp([{ path: "src/missing.ts", start: 1, end: 2 }], span([]));
    expect(gone.checks).toMatchObject({ l0: false, l0Raw: false });
    expect(gone.cites).toEqual([]);
  });
});

describe("GEN-U-031 L1: identifiers within the cited range ±2", () => {
  test("pass, fail, token fallback, vacuous ⇒ cited", async () => {
    const { v, metrics } = setup();
    expect((await v.stamp([{ path: "src/session/store.ts", start: 17, end: 19 }], span(["items.set()", "put"]))).checks.l1).toBe("pass");
    expect((await v.stamp([{ path: "src/session/store.ts", start: 2, end: 5 }], span(["handleLogin"]))).checks.l1).toBe("fail");
    const vac = await v.stamp([{ path: "src/session/store.ts", start: 2, end: 5 }], span([]));
    expect(vac.checks.l1).toBe("vacuous");
    expect(computeVerdict({ checks: vac.checks, cites: vac.cites.length, anyStale: false })).toBe("cited");
    expect(metrics.counts.get("gen.cite.l1.vacuous")).toBe(1);
    expect((await v.stamp([], span(["x"]))).checks.l1).toBe("vacuous");
  });

  test("the enclosing symbol's qualified name counts (real run 2026-10-04: `LoadingAnimator.update` cited inside update)", async () => {
    const { v, indexer } = setup();
    const inside = await v.stamp([{ path: "src/session/store.ts", start: 18, end: 18 }], span(["Store.put"]));
    expect(inside.checks.l1).toBe("pass");
    expect(inside.checks.repaired).toBeUndefined();
    // outside any symbol the scope is empty and the same claim still fails
    expect(l1(["Store.put"], [{ path: "src/session/store.ts", lines: ["", "x", "y"], start: 2, end: 2 }])).toBe("fail");
    expect(l1(["Store.put"], [{ path: "src/session/store.ts", lines: ["", "x", "y"], start: 2, end: 2, scope: ["Store.put"] }])).toBe("pass");
    // check() (L1 re-check of stored claims) uses the same scope
    const stamped = inside.cites[0] as Claim["cites"][number];
    expect((await v.check([{ cites: [stamped], markdown: "`Store.put` は保存する" }]))[0]?.l1).toBe("pass");
    expect(indexer.enclosingSymbol("src/session/store.ts", 18, 18)?.qualname).toBe("Store.put");
  });

  test("W08 relocates a single cite by the smallest shift and marks precision search", async () => {
    const { v } = setup();
    // ErrExpired is defined on line 22; the LLM cited 19..19 (3 lines off, outside ±2)
    const r = await v.stamp([{ path: "src/session/store.ts", start: 19, end: 19 }], span(["ErrExpired"]));
    expect(r.checks.l1).toBe("pass");
    expect(r.checks.repaired).toEqual(["relocate"]);
    expect(r.cites[0]).toMatchObject({ start: 20, end: 20, precision: "search" });
    const multi = await v.stamp(
      [
        { path: "src/session/store.ts", start: 2, end: 2 },
        { path: "src/auth/login.ts", start: 1, end: 1 },
      ],
      span(["handleLogin"]),
    );
    expect(multi.checks.l1).toBe("fail");
  });
});

describe("GEN-U-032 L2: snippet hash against the current blob", () => {
  test("check() is true until the cited lines change", async () => {
    const { indexer, v } = setup();
    const r = await v.stamp([{ path: "src/auth/login.ts", start: 3, end: 7 }], span(["login"]));
    const md = "`login` returns the id";
    expect((await v.check([{ markdown: md, cites: r.cites }]))[0]).toMatchObject({ l0: true, l1: "pass", l2: true });
    indexer.setFile("src/auth/login.ts", (await indexer.currentText("src/auth/login.ts"))?.replace("return id;", "return id.trim();") ?? "");
    expect((await v.check([{ markdown: md, cites: r.cites }]))[0]?.l2).toBe(false);
  });
});

describe("PT-05 stamping uses the blob the task input was built from", () => {
  test("a file edited after rendering is stamped against the remembered blob", async () => {
    const { indexer, v } = setup();
    const snap = indexer.snapshot()?.indexDigest ?? "";
    const before = indexer.currentBlob("src/auth/login.ts") as string;
    v.remember(snap, new Map([["src/auth/login.ts", before]]));
    indexer.setFile("src/auth/login.ts", `// header\n${(await indexer.currentText("src/auth/login.ts")) ?? ""}`);
    const r = await v.stamp([{ path: "src/auth/login.ts", start: 3, end: 7 }], span(["login"]), snap);
    expect(r.cites[0]?.blob).toBe(before);
    expect(r.checks.l1).toBe("pass");
    const now = await v.stamp([{ path: "src/auth/login.ts", start: 3, end: 7 }], span(["login"]));
    expect(now.cites[0]?.blob).not.toBe(before);
  });
});

describe("GEN-U-033 sampleForJudge: all L1 failures + deterministic 10 %", () => {
  test("stable selection", () => {
    const { v } = setup();
    const claims: Claim[] = Array.from({ length: 200 }, (_, i) => ({
      id: `cl_${String(i).padStart(8, "0")}` as ClaimId,
      block: "b_00000000",
      kind: "fact",
      quote: "",
      cites: [],
      verdict: "verified",
      checks: checks({ l1: i % 50 === 0 ? "fail" : "pass" }),
    }));
    const a = v.sampleForJudge(claims);
    expect(a).toEqual(v.sampleForJudge(claims));
    for (const c of claims.filter((x) => x.checks.l1 === "fail")) expect(a).toContain(c.id);
    expect(a.length).toBeGreaterThan(4);
    expect(a.length).toBeLessThan(60);
  });
});
