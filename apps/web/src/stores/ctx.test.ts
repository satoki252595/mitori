/** ux.md §4.4 context-column state machine (`ContextColumnStore`): margin | code | review, previous mode on back. */
import { beforeAll, describe, expect, test } from "bun:test";
import { installRunes } from "./__tests__/runes.ts";

installRunes();
let CtxState: typeof import("./ctx.svelte.ts").CtxState;
beforeAll(async () => {
  ({ CtxState } = await import("./ctx.svelte.ts"));
});

const pin = { path: "internal/daemon/daemon.go", start: 178, end: 193 };

describe("context column modes", () => {
  test("margin → `o` pins code → Escape / `o` returns to margin", () => {
    const c = new CtxState();
    expect(c.canGoBack).toBe(false);
    c.set("code", { pin });
    expect([c.mode, c.prev, c.canGoBack]).toEqual(["code", "margin", true]);
    c.back();
    expect([c.mode, c.pin, c.canGoBack]).toEqual(["margin", null, false]);
  });

  test("expert: the default code mode has nowhere to go back; pinning comes back to unpinned code", () => {
    const c = new CtxState();
    c.defaultFor("expert");
    expect([c.mode, c.canGoBack]).toEqual(["code", false]);
    c.set("code", { pin });
    expect(c.canGoBack).toBe(true);
    c.back();
    expect([c.mode, c.pin]).toEqual(["code", null]);
  });

  test("review keeps its mode on a level change; leaving review restores the previous mode", () => {
    const c = new CtxState();
    c.set("review", { job: "j_000000000001" as never });
    c.defaultFor("expert");
    expect(c.mode).toBe("review");
    c.back();
    expect(c.mode).toBe("margin");
  });
});
