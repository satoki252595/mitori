import { describe, expect, test } from "bun:test";
import { ID_ALPHABET, ID_SPEC, type IdKind } from "@mitori/core";
import type { RouteState } from "../contract.ts";
import { hrefRoute, parseRoute, viewKind } from "./router.ts";

/** Deterministic PRNG (mulberry32) for the property test. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gen(r: () => number) {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const id = <K extends IdKind>(k: K) => {
    const { prefix, len } = ID_SPEC[k];
    let s = prefix;
    for (let i = 0; i < len; i++) s += pick(ID_ALPHABET.split(""));
    return s;
  };
  const seg = () => pick(["internal", "auth", "login.go", "認証", "デーモン v2", "a b", "100%", "x#y", "q?r", "持ち越し.md", "src", "k&v=1"]);
  const path = () => Array.from({ length: 1 + Math.floor(r() * 4) }, seg).join("/");
  const section = () => {
    const top = pick(["s0", "s3", "s6", "s10", "s13", "appendix"] as const);
    return r() < 0.5 ? top : (`${top}/${Array.from({ length: 1 + Math.floor(r() * 2) }, seg).join("/")}` as const);
  };
  const ws = id("workspace") as `ws_${string}`;
  const opt = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(() => r() < 0.5)) as T;
  const states: (() => RouteState)[] = [
    () => ({ name: "launcher" }),
    () => ({ name: "map", ws, ...opt({ room: "md_room-1", zoom: pick(["Z0", "Z1", "Z2", "Z3"] as const), flow: section(), textView: true as const }) }),
    () => ({
      name: "doc",
      ws,
      section: section(),
      ...opt({
        block: id("block") as `b_${string}`,
        ctx: pick(["margin", "code", "review"] as const),
        pin: { path: path(), start: 3, end: 9 },
        thread: id("thread") as `th_${string}`,
      }),
    }),
    () => ({ name: "code", ws, path: path(), ...opt({ range: { start: 40, end: 78 } }) }),
    () => ({ name: "inbox", ws, view: pick(["all", "mine", "failed", "uncommitted"] as const), ...opt({ sel: "th_x" }) }),
    () => ({ name: "review", ws, job: id("job") as `j_${string}`, ...opt({ wide: true as const, hunk: `${path()}:12` as `${string}:${number}` }) }),
    () => ({ name: "reviewNext", ws }),
    () => ({ name: "thread", ws, th: id("thread") as `th_${string}` }),
    () => ({ name: "glossary", ws, ...opt({ term: id("glossary") as `gl_${string}` }) }),
    () => ({ name: "decisions", ws, ...opt({ dc: id("decision") as `dc_${string}` }) }),
    () => ({ name: "gen", ws, ...opt({ run: id("genRun") as `gr_${string}` }) }),
    () => ({ name: "wsSettings", ws, ...opt({ tab: pick(["workspace", "trust"] as const) }) }),
    () => ({ name: "settings", ...opt({ tab: pick(["general", "shortcuts"] as const) }) }),
  ];
  return () => pick(states)();
}

describe("AC-U10 parse(href(s)) === s for every APP_ROUTES state", () => {
  test("1,000 random states incl. Japanese file names and `/` in section ids", () => {
    const next = gen(rng(42));
    for (let i = 0; i < 1000; i++) {
      const s = next();
      const h = hrefRoute(s);
      expect(parseRoute(h)).toEqual(s);
    }
  });

  test("hrefs come from core HREFS", () => {
    expect(hrefRoute({ name: "doc", ws: "ws_0123456789ab", section: "s6/internal-session", block: "b_k3f9a2cq" })).toBe(
      "/w/ws_0123456789ab/doc/s6/internal-session#b_k3f9a2cq",
    );
    expect(hrefRoute({ name: "code", ws: "ws_0123456789ab", path: "internal/auth/login.go", range: { start: 40, end: 78 } })).toBe(
      "/w/ws_0123456789ab/code/internal/auth/login.go#L40-L78",
    );
  });

  test("parse never throws: unknown / invalid ⇒ launcher, invalid optional ⇒ dropped", () => {
    for (const u of [
      "/nope",
      "/w/bad/doc/s3",
      "/w/ws_0123456789ab/doc/zz",
      "/w/ws_0123456789ab/code/../etc",
      "/w/ws_0123456789ab/review/j_x/y",
      "%%%",
      "/w/ws_0123456789ab/doc/%E0%A4",
    ]) {
      expect(parseRoute(u)).toEqual({ name: "launcher" });
    }
    expect(parseRoute("/w/ws_0123456789ab?z=Z9&room=ok&junk=1")).toEqual({ name: "map", ws: "ws_0123456789ab", room: "ok" });
    expect(parseRoute("/w/ws_0123456789ab/inbox?f=nope")).toEqual({ name: "inbox", ws: "ws_0123456789ab", view: "mine" });
    expect(parseRoute("/w/ws_0123456789ab/code/a.go#L9-L3")).toEqual({ name: "code", ws: "ws_0123456789ab", path: "a.go" });
  });

  test("view kinds pick the route scopes (review ⇒ docReview)", () => {
    expect(viewKind({ name: "doc", ws: "ws_0123456789ab", section: "s3", ctx: "review" })).toBe("docReview");
    expect(viewKind({ name: "map", ws: "ws_0123456789ab" })).toBe("map");
    expect(viewKind({ name: "settings" })).toBe("other");
  });
});
