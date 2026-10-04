import { describe, expect, test } from "bun:test";
import type { PaletteItem } from "@mitori/core";
import { queryForms, toHiragana } from "./normalize.ts";
import { buildIndex, runQuery } from "./search.ts";

const term = (i: string, l: string, y: string, r: string, al: string[] = []): PaletteItem => ({ k: "t", i, l, y, r, al, h: `/g/${i}` });
const sym = (l: string, s: string, via?: string): PaletteItem => ({ k: "y", i: `${s}#${l}`, l, s, h: `/c/${l}`, ...(via ? { via } : {}) });

const ITEMS: PaletteItem[] = [
  term("gl_mochikos", "持ち越し", "もちこし", "mochikoshi", ["carry-forward", "motikosi"]),
  term("gl_ninshou0", "認証", "にんしょう", "ninshou", ["auth", "authentication"]),
  { k: "s", i: "s6/carry", l: "§6.3 コメントの持ち越し", r: "komentonomochikoshi", h: "/d/s6" },
  sym("carryForwardComments", "internal/session/watch.go:464", "gl_mochikos"),
  sym("carryForwardAllComments", "internal/session/watch.go:532", "gl_mochikos"),
  sym("remapLines", "internal/session/watch.go:1098", "gl_mochikos"),
  sym("WorkerPool", "packages/core/src/domain.ts:4004"),
  sym("Login", "internal/auth/login.go:40"),
  sym("loginHandler", "internal/auth/http.go:12"),
  sym("chunkSize", "internal/stream/chunk.go:9"),
  sym("chunkReader", "internal/stream/chunk.go:30"),
  sym("route", "internal/router/route.go:3"),
  sym("routeTable", "internal/router/table.go:3"),
  sym("loop", "internal/agent/loop.go:3"),
  { k: "m", i: "md_session", l: "session", s: "internal/session", h: "/w?room=md_session" },
];

const ix = buildIndex(1, ITEMS, [{ k: "a", i: "action.theme", l: "Toggle theme", al: ["dark", "light"] }]);
const top = (q: string) => runQuery(ix, q, "all", 3).groups[0]?.items[0];
const firstOf = (q: string, group: string) => runQuery(ix, q, "all", 3).groups.find((g) => g.group === group)?.items;

describe("AC-J46 / AC-U70 palette matching (ux.md §4.10)", () => {
  for (const q of ["mochi", "mochikoshi", "motikosi", "もちこし", "モチコシ", "carry", "mochikosh"]) {
    test(`'${q}' ⇒ 持ち越し first with a reason badge`, () => {
      const it = top(q);
      expect(it?.label).toBe("持ち越し");
      if (!/^\p{Script=Hiragana}|\p{Script=Katakana}/u.test(q)) expect(it?.reason?.kind).toBe("alias");
    });
  }

  test("ninshou / にんしょう ⇒ 認証", () => {
    expect(top("ninshou")?.label).toBe("認証");
    expect(top("にんしょう")?.label).toBe("認証");
  });

  test("symbols linked to a matching term carry a 「…」経由 badge", () => {
    const syms = firstOf("mochi", "symbol");
    expect(syms?.map((s) => s.reason)).toContainEqual({ kind: "via", text: "持ち越し" });
  });

  test("label marks are UTF-16 ranges of the original label", () => {
    const it = firstOf("Pool", "symbol")?.[0];
    expect(it?.label).toBe("WorkerPool");
    expect(it?.marks).toEqual([[6, 10]]);
  });
});

describe("AC-J46b label is never romaji-normalized; r tolerates an incomplete tail", () => {
  test.each([
    ["pool", "WorkerPool"],
    ["loop", "loop"],
    ["route", "route"],
    ["chunk", "chunkSize"],
    ["carry-forward", "carryForwardComments"],
  ])("'%s' ⇒ %s first in the symbol group", (q, label) => {
    expect(firstOf(q, "symbol")?.[0]?.label).toBe(label);
  });

  test("every prefix of chunkSize keeps it in the symbol top 3", () => {
    for (let n = 1; n <= "chunkSize".length; n++) {
      const labels = firstOf("chunkSize".slice(0, n), "symbol")?.map((s) => s.label) ?? [];
      expect(labels).toContain("chunkSize");
    }
  });

  test("query forms", () => {
    expect(queryForms("Mochikosh").romaji).toBe("motikos");
    expect(queryForms("カタカナ").kana).toBe(toHiragana("カタカナ"));
    expect(queryForms("持ち").romaji).toBeNull();
  });

  test("UXP-29 top hit ≥ 120 for a label prefix; prefix modes", () => {
    expect((firstOf("Login", "symbol")?.[0]?.score ?? 0) >= 120).toBe(true);
    expect(firstOf("Login", "symbol")?.[0]?.label).toBe("Login");
    const onlyActions = runQuery(ix, ">theme", "all", 3).groups.map((g) => g.group);
    expect(onlyActions).toEqual(["action"]);
    expect(runQuery(ix, "@session", "all", 3).groups.map((g) => g.group)).toEqual(["symbol"]);
    expect(runQuery(ix, "@zzzz", "all", 3).groups).toEqual([]);
    expect(runQuery(ix, "#mochi", "all", 3).groups.map((g) => g.group)).toEqual(["section"]);
  });

  test("top-hit row: best ≥ 120, a via-symbol yields to its matching term (AC-J46 'carry')", () => {
    expect(runQuery(ix, "Login", "all", 3).top).toEqual({ group: "symbol", id: "internal/auth/login.go:40#Login" });
    // carryForwardComments (label prefix, 139) is tied to 持ち越し, which matched via its alias
    expect(runQuery(ix, "carry", "all", 3).top).toEqual({ group: "term", id: "gl_mochikos" });
    expect(runQuery(ix, "pool", "all", 3).top).toBeNull();
    expect(runQuery(ix, "", "all", 3).top).toBeNull();
    // a filter that hides terms keeps the symbol as the top hit
    expect(runQuery(ix, "@carry", "all", 3).top?.group).toBe("symbol");
  });
});

describe("ui.palette: one keystroke over 50k items answers (worker side; the 16 ms is bench ui.palette.worker)", () => {
  test("50k synthetic items", () => {
    const words = ["session", "watch", "comment", "carry", "forward", "remap", "lines", "daemon", "router", "chunk", "reader", "writer", "pool", "loop"];
    const big: PaletteItem[] = [];
    for (let i = 0; i < 50_000; i++) {
      const a = words[i % words.length] as string;
      const b = words[(i * 7) % words.length] as string;
      big.push({ k: i % 5 === 0 ? "s" : "y", i: `x${i}`, l: `${a}${b[0]?.toUpperCase()}${b.slice(1)}${i}`, s: `internal/${a}/${b}.go:${i}`, h: `/x/${i}` });
    }
    big.push(...ITEMS);
    const bix = buildIndex(2, big, []);
    const times: number[] = [];
    for (const q of ["m", "mo", "moc", "moch", "mochi", "carry", "carryf", "もち", "zz", "watch.go"]) {
      const t0 = performance.now();
      runQuery(bix, q, "all", 3);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95) - 1] ?? 0;
    // a generous deadline (no pathological scan); the 16 ms budget is timed by the load-gated bench case
    // ui.palette.worker (bench/ui.bench.ts) and end to end by ui.palette
    expect(p95).toBeLessThan(250);
  });
});
