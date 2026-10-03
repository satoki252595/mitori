/**
 * WEB-U-008..011 / WEB-U-020 on the real registry (`KeysStore`, rune module compiled for the test): one capture
 * listener on a fake window, IME guard, editable targets, full-width input, sequences, single-key switch.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { ShortcutScope } from "../contract.ts";
import { installRunes } from "./__tests__/runes.ts";

installRunes();
let KeysStore: typeof import("./keys.svelte.ts").KeysStore;
beforeAll(async () => {
  ({ KeysStore } = await import("./keys.svelte.ts"));
});

type FakeTarget = { tagName: string; isContentEditable?: boolean; closest?: (s: string) => unknown };
const BODY: FakeTarget = { tagName: "BODY", closest: () => null };
const INPUT: FakeTarget = { tagName: "INPUT", closest: () => null };

function keyEvent(
  type: "keydown" | "keyup",
  init: {
    key: string;
    code: string;
    keyCode?: number;
    isComposing?: boolean;
    target?: FakeTarget;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    repeat?: boolean;
  },
) {
  const e = new Event(type, { cancelable: true });
  const props = {
    keyCode: 0,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...init,
    target: init.target ?? BODY,
  };
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  return e;
}

function setup(opts: { scopes?: ShortcutScope[]; singleKeys?: boolean } = {}) {
  const win = new EventTarget();
  const keys = new KeysStore();
  const fired: string[] = [];
  let hints = 0;
  const scopes = opts.scopes ?? (["read", "global"] as ShortcutScope[]);
  keys.attach(win as unknown as Window, {
    scopes: () => scopes,
    when: () => true,
    singleKeys: () => opts.singleKeys ?? true,
    imeHint: () => hints++,
    holdAlt: () => {},
  });
  for (const id of ["read.next", "read.prev", "nav.map", "level.up", "level.down", "palette.open", "help.open"]) keys.on(id, () => fired.push(id));
  const press = (key: string, code: string, extra: Parameters<typeof keyEvent>[1] extends infer T ? Partial<T> : never = {}) => {
    const e = keyEvent("keydown", { key, code, ...extra });
    win.dispatchEvent(e);
    win.dispatchEvent(keyEvent("keyup", { key, code, ...extra }));
    return e;
  };
  return { keys, fired, press, hints: () => hints };
}

describe("WEB-U-008..011 IME guard on the registry", () => {
  test("WEB-U-008 keyCode 229 / Process on the page: nothing fires, the hint callback runs", () => {
    const { fired, press, hints } = setup();
    press("Process", "KeyJ", { keyCode: 229 });
    press("j", "KeyJ", { keyCode: 229 });
    expect(fired).toEqual([]);
    expect(hints()).toBe(2); // the shell shows the toast once per session (sessionStorage)
  });

  test("WEB-U-009 the same keys inside an editable never fire single-key shortcuts (no hint either)", () => {
    const { fired, press, hints } = setup();
    press("j", "KeyJ", { target: INPUT });
    press("j", "KeyJ", { keyCode: 229, target: INPUT });
    expect(fired).toEqual([]);
    expect(hints()).toBe(0);
  });

  test("WEB-U-010 full-width ｊ (code KeyJ) ⇒ read.next", () => {
    const { fired, press } = setup();
    press("ｊ", "KeyJ");
    expect(fired).toEqual(["read.next"]);
  });

  test("WEB-U-011 symbols while composing are inert", () => {
    const { fired, press } = setup();
    for (const [k, c] of [
      ["/", "Slash"],
      ["?", "Slash"],
      ["-", "Minus"],
      ["=", "Equal"],
      ["[", "BracketLeft"],
      ["]", "BracketRight"],
    ] as const)
      press(k, c, { isComposing: true });
    expect(fired).toEqual([]);
  });
});

describe("WEB-U-020 registry behaviour", () => {
  test("g h sequence fires nav.map and shows the pending prefix meanwhile; an unknown second key cancels", () => {
    const { keys, fired, press } = setup();
    press("g", "KeyG");
    expect(keys.pendingPrefix).not.toBeNull();
    press("h", "KeyH");
    expect(fired).toEqual(["nav.map"]);
    expect(keys.pendingPrefix).toBeNull();
    press("g", "KeyG");
    press("q", "KeyQ");
    expect(keys.pendingPrefix).toBeNull();
    expect(fired).toEqual(["nav.map"]);
  });

  test("singleKeyShortcuts = false disables every single-key binding but keeps ⌘K (WCAG 2.1.4)", () => {
    const { fired, press, keys } = setup({ singleKeys: false });
    press("j", "KeyJ");
    press("-", "Minus");
    press("k", "KeyK", keys.mac ? { metaKey: true } : { ctrlKey: true });
    expect(fired).toEqual(["palette.open"]);
  });

  test("Mod+K from an input still opens the palette; plain letters there do nothing", () => {
    const { fired, press, keys } = setup();
    press("k", "KeyK", { target: INPUT, ...(keys.mac ? { metaKey: true } : { ctrlKey: true }) });
    press("k", "KeyK", { target: INPUT });
    expect(fired).toEqual(["palette.open"]);
  });

  test("a handled shortcut prevents the browser default; an unbound key does not", () => {
    const { press } = setup();
    expect(press("j", "KeyJ").defaultPrevented).toBe(true);
    expect(press("q", "KeyQ").defaultPrevented).toBe(false);
  });

  test("scope decides: read keys are inert when only global is active", () => {
    const { fired, press } = setup({ scopes: ["global"] });
    press("j", "KeyJ");
    expect(fired).toEqual([]);
  });
});
