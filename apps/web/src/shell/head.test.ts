/**
 * WEB-U-030 head inline script: restores theme · reader level · language · code-pane width · rail from
 * `mitori_ui` before the first paint, never throws on a bad cookie, preloads the language + view chunks, and the
 * inlined source (Function.toString, the CSP-hashed bytes) runs stand-alone.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseUiCookieFields, serializeUiCookie } from "./cookie.ts";
import { bootHead } from "./head.ts";

type FakeEl = { rel?: string; href?: string };
function fakeDoc(cookie: string) {
  const props = new Map<string, string>();
  const links: FakeEl[] = [];
  const h = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => props.set(k, v) }, lang: "" };
  const d = { documentElement: h, cookie, createElement: () => ({}) as FakeEl, head: { appendChild: (l: FakeEl) => links.push(l) } };
  return { d: d as unknown as Document, h, props, links };
}

const CHUNKS = { ja: "/assets/i18n-ja.js", en: "/assets/i18n-en.js", map: "/assets/map.js", reader: "/assets/reader.js" };
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of ["location", "requestAnimationFrame"]) saved[k] = g[k];
  g.requestAnimationFrame = (fn: () => void) => fn();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) g[k] = v;
});

const at = (pathname: string) => {
  g.location = { pathname };
};

describe("WEB-U-030 bootHead", () => {
  test("restores every field and preloads the reader chunk on a doc URL", () => {
    at("/w/ws_cr1t00000000/doc/s3");
    const { d, h, props, links } = fakeDoc(`a=1; mitori_ui=${serializeUiCookie({ v: 1, lv: "e", lg: "en", th: "d", cw: 640, rc: 1 })}`);
    bootHead(d, parseUiCookieFields, CHUNKS);
    expect(h.dataset).toEqual({ level: "expert", theme: "dark", rail: "collapsed", boot: "doc" });
    expect(h.lang).toBe("en");
    expect(props.get("--ctx-w-code")).toBe("640px");
    expect(links.map((l) => [l.rel, l.href])).toEqual([
      ["modulepreload", CHUNKS.en],
      ["modulepreload", CHUNKS.reader],
    ]);
  });

  test("garbage / missing cookie ⇒ defaults, no throw; S1 preloads the map chunk", () => {
    at("/w/ws_cr1t00000000");
    for (const cookie of ["mitori_ui=%E0%A4%A", "mitori_ui={not json", "mitori_ui=", "", `mitori_ui=${"x".repeat(4000)}`]) {
      const { d, h, links } = fakeDoc(cookie);
      expect(() => bootHead(d, parseUiCookieFields, CHUNKS)).not.toThrow();
      expect(h.dataset.level).toBe("standard");
      expect(h.dataset.theme).toBeUndefined();
      expect(["ja", "en"]).toContain(h.lang);
      expect(links.map((l) => l.href)).toContain(CHUNKS.map);
    }
  });

  test("the inlined bytes (as vite.config.ts builds them) run with only globals", () => {
    at("/");
    const src = `(${bootHead.toString()})(document,${parseUiCookieFields.toString()},${JSON.stringify(CHUNKS)});`;
    const { d, h } = fakeDoc(`mitori_ui=${serializeUiCookie({ v: 1, lv: "n", lg: "ja" })}`);
    new Function("document", src)(d);
    expect(h.dataset.level).toBe("newcomer");
    expect(h.dataset.boot).toBe("launcher");
    expect(h.lang).toBe("ja");
  });
});
