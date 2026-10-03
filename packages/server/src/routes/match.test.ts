import { describe, expect, test } from "bun:test";
import { type DocId, ROUTE_META, type WorkspaceKey } from "@mitori/core";
import { ROUTE_OWNERS } from "../contract.ts";
import { resolveDocId } from "../ws/index.ts";
import { matchRoute, ROUTE_KEYS } from "./match.ts";

describe("route matching", () => {
  test("every ROUTE_META key matches its own template; owners and meta cover the same keys", () => {
    expect(ROUTE_KEYS.length).toBe(Object.keys(ROUTE_OWNERS).length);
    for (const key of ROUTE_KEYS) {
      const [method = "", tpl = ""] = key.split(" ");
      const path = tpl.replace(/:([a-z]+)/g, (_m, p: string) => (p === "ws" ? "ws_aaaaaaaaaaaa" : `v${p}`));
      expect([key, matchRoute(method, path)?.key]).toEqual([key, key]);
      expect(ROUTE_META[key]).toBeDefined();
    }
  });

  test("params are decoded after splitting on the raw `/` (section ids keep `/`); literals win over params", () => {
    const m = matchRoute("GET", "/ws/ws_aaaaaaaaaaaa/doc/sections/s3%2Fauth%20flow");
    expect(m).toMatchObject({ key: "GET /ws/:ws/doc/sections/:section", params: { ws: "ws_aaaaaaaaaaaa", section: "s3/auth flow" } });
    expect(matchRoute("POST", "/ws/ws_aaaaaaaaaaaa/jobs/estimate")?.key).toBe("POST /ws/:ws/jobs/estimate");
    expect(matchRoute("GET", "/ws/ws_aaaaaaaaaaaa/search/palette")?.key).toBe("GET /ws/:ws/search/palette");
    expect(matchRoute("GET", "/health/")?.key).toBe("GET /health");
    expect(matchRoute("GET", "/ws//doc")).toBeNull();
    expect(matchRoute("PUT", "/health")).toBeNull();
    expect(matchRoute("GET", "/nope")).toBeNull();
    expect(() => matchRoute("GET", "/ws/%E0%A4%A")).toThrow("percent-encoding");
  });
});

describe("resolveDocId (UXP-13)", () => {
  test("first workspace carrying the doc id wins; unknown ⇒ null", () => {
    const reg = [
      { key: "ws_aaaaaaaaaaaa" as WorkspaceKey },
      { key: "ws_bbbbbbbbbbbb" as WorkspaceKey, docId: "doc_111111111111" as DocId },
      { key: "ws_cccccccccccc" as WorkspaceKey, docId: "doc_111111111111" as DocId },
    ];
    expect(resolveDocId("doc_111111111111" as DocId, reg)).toBe("ws_bbbbbbbbbbbb" as WorkspaceKey);
    expect(resolveDocId("doc_999999999999" as DocId, reg)).toBeNull();
    expect(resolveDocId("doc_111111111111" as DocId, [])).toBeNull();
  });
});
