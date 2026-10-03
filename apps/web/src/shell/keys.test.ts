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

  test("a route-scope binding that shadows a global one is a conflict (remap `h` → `b` would hide pane.nav in S2)", () => {
    const next = DEFAULT_DEFS.map((d) => (d.id === "threads.hideResolved" ? { ...d, keys: ["b"] } : d));
    expect(findConflicts(next, true)).toEqual([{ binding: "b", ids: ["pane.nav", "threads.hideResolved"], scope: "read" }]);
  });

  test("a single chord that prefixes a global sequence is a conflict (`g` vs `g h`)", () => {
    const next = DEFAULT_DEFS.map((d) => (d.id === "copy.permalink" ? { ...d, keys: ["g"] } : d));
    const c = findConflicts(next, true);
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.ids.includes("copy.permalink") && x.binding === "g")).toBe(true);
  });

  test("designed precedences are not conflicts: palette/composer over global, review over read (docReview)", () => {
    // review.prevJob `[` vs thread.prev `[` are both active in docReview; palette.actions ⌘K vs palette.open ⌘K
    expect(findConflicts(DEFAULT_DEFS, true).some((x) => x.ids.includes("review.prevJob") || x.ids.includes("palette.actions"))).toBe(false);
    // same key in sets that are never active together (map vs read `-`) stays allowed
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
