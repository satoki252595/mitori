/**
 * NC-14 / ux.md §3.2-6 a preference change survives a reload inside the 1 s debounce: the unsent patch is kept in
 * localStorage, the next page sends it first (and holds the server's copy back meanwhile), and the mark goes once
 * the server took it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ApiClient } from "@mitori/client";
import { installRunes } from "./__tests__/runes.ts";

installRunes();
let PrefsState: typeof import("./prefs.svelte.ts").PrefsState;
let PENDING: string;
beforeAll(async () => {
  const m = await import("./prefs.svelte.ts");
  PrefsState = m.PrefsState;
  PENDING = m.PENDING_PREFS_KEY;
});

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

function api() {
  const calls: { key: string; body: unknown }[] = [];
  const a = {
    call: async (key: string, args: { body?: unknown }) => {
      calls.push({ key, body: args.body });
      return { version: calls.length + 3 };
    },
  } as unknown as ApiClient;
  return { a, calls };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("NC-14 prefs survive a reload", () => {
  test("a change is kept until the server took it", async () => {
    const { a, calls } = api();
    const p = new PrefsState(a);
    p.setLang("en");
    expect(JSON.parse(store.get(PENDING) ?? "{}")).toEqual({ ui: { lang: "en" } });
    expect(p.pending).toBe(true);
    // the page goes away before the debounce: the next page finds the patch and sends it at once
    const next = api();
    const q = new PrefsState(next.a);
    expect(q.pending).toBe(true);
    // it waits for the settings version (a guessed one only earns a 409), then goes at once
    await wait(20);
    expect(next.calls).toEqual([]);
    q.noteVersion(7);
    await wait(20);
    expect(next.calls.map((c) => c.key)).toEqual(["PATCH /settings"]);
    expect(next.calls[0]?.body).toEqual({ version: 7, patch: { ui: { lang: "en" } } });
    expect(store.has(PENDING)).toBe(false);
    expect(q.pending).toBe(false);
    void calls;
  });

  test("an immediate level change (first run) is sent at once and still held as pending", async () => {
    const { a, calls } = api();
    const p = new PrefsState(a);
    p.setLevel("newcomer", { immediate: true });
    await wait(5);
    expect(calls.map((c) => c.key)).toEqual(["PATCH /settings"]);
    expect(p.pending).toBe(true);
  });

  test("an older acknowledgement keeps newer in-flight edits and failed writes survive the next edit", async () => {
    store.set(PENDING, JSON.stringify({ ui: { lang: "en" } }));
    const calls: unknown[] = [];
    const replies: { resolve: (v: { version: number }) => void; reject: (err: Error) => void }[] = [];
    const a = {
      call: (_key: string, args: { body: unknown }) => {
        calls.push(args.body);
        return new Promise<{ version: number }>((resolve, reject) => replies.push({ resolve, reject }));
      },
    } as unknown as ApiClient;
    const p = new PrefsState(a);
    p.noteVersion(7);
    await wait(20);
    p.setLang("ja");
    p.setTheme("dark");
    await wait(1100);
    expect(calls).toHaveLength(1); // the second write waits for the first, including its conflict retry
    expect(p.pending).toBe(true);
    replies[0]?.resolve({ version: 8 });
    await wait(20);
    expect(calls[1]).toEqual({ version: 8, patch: { ui: { lang: "ja", theme: "dark" } } });
    expect(JSON.parse(store.get(PENDING) ?? "{}")).toEqual({ ui: { lang: "ja", theme: "dark" } });
    replies[1]?.reject(new Error("offline"));
    await wait(20);
    expect(p.pending).toBe(true);
    p.setEditor("cursor");
    await wait(1100);
    expect(calls[2]).toEqual({ version: 8, patch: { ui: { lang: "ja", theme: "dark", editor: "cursor" } } });
    replies[2]?.resolve({ version: 9 });
    await wait(20);
    expect(p.pending).toBe(false);
    expect(store.has(PENDING)).toBe(false);
  });
});
