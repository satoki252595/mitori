import { describe, expect, test } from "bun:test";
import { DEFAULT_KEYMAP, ROUTE_SCOPES } from "../contract.ts";
import { bindingLabel, chordOf, DEFAULT_DEFS, findConflicts, isSingleKeyBinding, normalizeBinding } from "./keys.ts";

const ev = (o: Partial<{ key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({
  key: "",
  code: "",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...o,
});

describe("WEB-U keys: chord matching (ux.md §8.2)", () => {
  test("letters and digits by code, IME full-width included (I10)", () => {
    expect(chordOf(ev({ key: "ｊ", code: "KeyJ" }), true)).toBe("j");
    expect(chordOf(ev({ key: "C", code: "KeyC", shiftKey: true }), true)).toBe("Shift+c");
    expect(chordOf(ev({ key: "!", code: "Digit1", shiftKey: true }), true)).toBe("Shift+1");
    expect(chordOf(ev({ key: "1", code: "Numpad1" }), false)).toBe("1");
    expect(chordOf(ev({ key: "∆", code: "KeyJ", altKey: true }), true)).toBe("Alt+j");
  });

  test("symbols by key, Shift ignored (JIS = is Shift+-), never with Mod", () => {
    expect(chordOf(ev({ key: "=", code: "Minus", shiftKey: true }), true)).toBe("=");
    expect(chordOf(ev({ key: "?", code: "Slash", shiftKey: true }), true)).toBe("?");
    expect(chordOf(ev({ key: "/", code: "Slash", metaKey: true }), true)).toBeNull();
  });

  test("Mod = ⌘ on mac, Ctrl elsewhere; Ctrl binding folds into Mod off mac", () => {
    expect(chordOf(ev({ key: "k", code: "KeyK", metaKey: true }), true)).toBe("Mod+k");
    expect(chordOf(ev({ key: "k", code: "KeyK", ctrlKey: true }), false)).toBe("Mod+k");
    expect(chordOf(ev({ key: "n", code: "KeyN", ctrlKey: true }), true)).toBe("Ctrl+n");
    expect(normalizeBinding("Ctrl+N", false)).toBe("Mod+n");
    expect(normalizeBinding("Alt+Mod+Enter", true)).toBe("Alt+Mod+Enter");
    expect(normalizeBinding("Mod+Alt+Enter", true)).toBe("Alt+Mod+Enter");
    expect(normalizeBinding("g h", true)).toBe("g h");
    expect(normalizeBinding("Mod+?", true)).toBeNull();
    expect(normalizeBinding("Hyper+x", true)).toBeNull();
  });

  test("labels per OS", () => {
    expect(bindingLabel("Mod+K", true)).toBe("⌘K");
    expect(bindingLabel("Mod+K", false)).toBe("Ctrl+K");
    expect(bindingLabel("Shift+F", true)).toBe("⇧F");
    expect(bindingLabel("g d", true)).toBe("g d");
    expect(bindingLabel("Mod+Enter", true)).toBe("⌘⏎");
  });

  test("single-key classification matches the contract flags", () => {
    for (const d of DEFAULT_KEYMAP) {
      if (d.keys.some((k) => k.startsWith("hold:")) || d.id === "composer.mention") continue;
      expect([d.id, d.keys.every(isSingleKeyBinding)]).toEqual([d.id, d.singleKey]);
    }
  });
});

describe("AC-J55 default keymap: no conflicts within any simultaneously active scope set", () => {
  test("conflicts() is empty", () => {
    expect(findConflicts(DEFAULT_DEFS, true)).toEqual([]);
    expect(findConflicts(DEFAULT_DEFS, false)).toEqual([]);
  });

  test("snapshot of the effective scope table", () => {
    const table: Record<string, string[]> = {};
    for (const [view, scopes] of Object.entries(ROUTE_SCOPES)) {
      table[view] = DEFAULT_DEFS.filter((d) => (scopes as readonly string[]).includes(d.scope)).map((d) => `${d.scope}:${d.id}=${d.keys.join("|")}`);
    }
    // S1: -/=/0 are zoom only; S2: reader level only
    expect(table.map?.filter((r) => /=(-|=|0)$/.test(r))).toEqual(["map:map.zoomIn==", "map:map.zoomOut=-", "map:map.fit=0"]);
    expect(table.doc?.filter((r) => /=(-|=|0)$/.test(r))).toEqual(["read:level.down=-", "read:level.up==", "read:level.reset=0"]);
    expect(table).toMatchSnapshot();
  });
});
