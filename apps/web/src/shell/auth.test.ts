/**
 * SEC-06 browser login (api `PAGE_ROUTES.auth`): the nonce lives in the fragment, is exchanged once, the token goes
 * to `localStorage[LOCAL_KEYS.session]`, the fragment leaves the address bar whatever happens, and `to` can only be a
 * same-origin app path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ApiClient } from "@mitori/client";
import { LOCAL_KEYS, MitoriError } from "@mitori/core";
import { completeLogin, isAppPath, parseAuthFragment } from "./auth.ts";

describe("parseAuthFragment", () => {
  test("nonce + to", () => {
    expect(parseAuthFragment("#n=abcdEFGH1234_-&to=/w/ws_cr1t00000000/doc/s3")).toEqual({ nonce: "abcdEFGH1234_-", to: "/w/ws_cr1t00000000/doc/s3" });
    expect(parseAuthFragment("#n=abcdEFGH1234")).toEqual({ nonce: "abcdEFGH1234", to: "/" });
  });

  test("a malformed nonce is refused", () => {
    expect(parseAuthFragment("#n=short")).toBeNull();
    expect(parseAuthFragment("#n=has%20space%20inside")).toBeNull();
    expect(parseAuthFragment("")).toBeNull();
  });

  test.each(["//evil.example/x", "/\\evil.example", "/w/x\\..\\y", "https://evil.example/", "javascript:alert(1)", "/w/a b", "/w/a\nb", "w/relative"])(
    "`to=%p` falls back to /",
    (to) => {
      expect(isAppPath(to)).toBe(false);
      expect(parseAuthFragment(`#n=abcdEFGH1234&to=${encodeURIComponent(to)}`)?.to).toBe("/");
    },
  );
});

describe("completeLogin", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const api = (impl: () => Promise<unknown>) => ({ call: impl }) as unknown as ApiClient;

  test("exchanges the nonce once, stores the token, rewrites the URL to `to`", async () => {
    const urls: string[] = [];
    let calls = 0;
    const ok = await completeLogin(
      api(async () => {
        calls++;
        return { token: "tok_1", session: "se_1", expiresAt: "2026-11-01T00:00:00Z" };
      }),
      { pathname: "/auth", hash: "#n=abcdEFGH1234&to=/w/ws_cr1t00000000" },
      { replaceState: (_s: unknown, _t: string, u?: string | URL | null) => void urls.push(String(u)) },
    );
    expect([ok, calls, urls]).toEqual([true, 1, ["/w/ws_cr1t00000000"]]);
    expect(store.get(LOCAL_KEYS.session)).toBe("tok_1");
  });

  test("a failed exchange still removes the fragment and stores nothing", async () => {
    const urls: string[] = [];
    const ok = await completeLogin(
      api(async () => {
        throw new MitoriError("E_AUTH_REQUIRED", "used nonce");
      }),
      { pathname: "/auth", hash: "#n=abcdEFGH1234&to=/settings" },
      { replaceState: (_s: unknown, _t: string, u?: string | URL | null) => void urls.push(String(u)) },
    );
    expect([ok, urls, store.size]).toEqual([false, ["/settings"], 0]);
  });

  test("other paths are left alone", async () => {
    const urls: string[] = [];
    const ok = await completeLogin(
      api(async () => ({})),
      { pathname: "/w/ws_cr1t00000000", hash: "#n=abcdEFGH1234" },
      { replaceState: () => void urls.push("x") },
    );
    expect([ok, urls]).toEqual([false, []]);
  });
});
