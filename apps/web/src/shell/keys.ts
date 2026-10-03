/**
 * Key binding grammar and matching (ux.md §8.2, contract `KeyBinding`). Pure: the registry store
 * (stores/keys.svelte.ts) owns the single capture listener and calls these.
 *
 * Canonical form: modifiers in alphabetical order (`Alt+Ctrl+Mod+Shift+`), letters lower-case, `Ctrl` folded into
 * `Mod` off macOS (where both are the Control key). Letters/digits match by `KeyboardEvent.code` (IME full-width
 * and non-Latin layouts still hit the physical key); the symbols below match by `key` and ignore Shift (JIS-safe).
 */
import { DEFAULT_KEYMAP, type KeyBinding, type KeyConflict, ROUTE_SCOPES, type ShortcutDef, type ShortcutScope } from "../contract.ts";

const MODS = ["Alt", "Ctrl", "Mod", "Shift"] as const;
type Mod = (typeof MODS)[number];
export const SYMBOL_KEYS: ReadonlySet<string> = new Set(["/", "?", "-", "=", "[", "]", "@", ",", "."]);
const NAMED = new Set(["Enter", "Escape", "Backspace", "Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

export interface KeyEventLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isMacPlatform(nav?: { platform?: string; userAgentData?: { platform?: string } } | null): boolean {
  const n = nav ?? (typeof navigator === "undefined" ? null : (navigator as Navigator & { userAgentData?: { platform?: string } }));
  const p = n?.userAgentData?.platform ?? n?.platform ?? "";
  return /mac|iphone|ipad/i.test(p);
}

/** Physical key of an event (`KeyJ` → `j`, `Digit1`/`Numpad1` → `1`), else the symbol / named key, else null. */
export function keyName(e: Pick<KeyEventLike, "key" | "code">): string | null {
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return (letter[1] as string).toLowerCase();
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digit) return digit[1] as string;
  if (SYMBOL_KEYS.has(e.key)) return e.key;
  if (e.key === " ") return "Space";
  if (NAMED.has(e.key)) return e.key;
  return null;
}

function canon(mods: ReadonlySet<Mod>, key: string): string {
  return [...MODS.filter((m) => mods.has(m)), key].join("+");
}

/** Canonical chord of a keydown, or null for keys we never bind (bare modifiers, unknown keys). */
export function chordOf(e: KeyEventLike, mac: boolean): string | null {
  const key = keyName(e);
  if (key === null) return null;
  const mods = new Set<Mod>();
  if (e.altKey) mods.add("Alt");
  if (mac) {
    if (e.metaKey) mods.add("Mod");
    if (e.ctrlKey) mods.add("Ctrl");
  } else if (e.ctrlKey || e.metaKey) mods.add("Mod");
  if (SYMBOL_KEYS.has(key)) {
    // symbols ignore Shift; with Mod/Ctrl/Alt they never match a binding
    return mods.size > 0 ? null : key;
  }
  if (e.shiftKey) mods.add("Shift");
  return canon(mods, key);
}

/** Canonical form of one chord of a binding string; null when invalid. */
export function normalizeChord(chord: string, mac: boolean): string | null {
  const parts = chord.split("+");
  let key = parts.pop() ?? "";
  if (key === "" && chord.endsWith("+")) return null;
  const mods = new Set<Mod>();
  for (const p of parts) {
    if (!(MODS as readonly string[]).includes(p)) return null;
    mods.add(!mac && p === "Ctrl" ? "Mod" : (p as Mod));
  }
  if (/^[A-Za-z]$/.test(key)) key = key.toLowerCase();
  else if (!(/^\d$/.test(key) || SYMBOL_KEYS.has(key) || NAMED.has(key))) return null;
  if (SYMBOL_KEYS.has(key) && mods.size > 0) return null;
  return canon(mods, key);
}

export type ParsedBinding = { kind: "seq"; chords: string[] } | { kind: "hold"; mod: "Alt" | "Shift" | "Mod" | "Ctrl" };

export function parseBinding(b: KeyBinding, mac: boolean): ParsedBinding | null {
  if (b.startsWith("hold:")) {
    const m = b.slice(5);
    return (MODS as readonly string[]).includes(m) ? { kind: "hold", mod: m as Mod } : null;
  }
  const chords = b.split(" ");
  if (chords.length < 1 || chords.length > 2) return null;
  const out: string[] = [];
  for (const c of chords) {
    const n = normalizeChord(c, mac);
    if (n === null) return null;
    out.push(n);
  }
  return { kind: "seq", chords: out };
}

/** Canonical binding string (`g h`, `Mod+k`, `hold:Alt`), or null. */
export function normalizeBinding(b: KeyBinding, mac: boolean): string | null {
  const p = parseBinding(b, mac);
  if (!p) return null;
  return p.kind === "hold" ? `hold:${p.mod}` : p.chords.join(" ");
}

/** Human label for the current OS (`⌘K` / `Ctrl+K`, `g h`, `⇧F`). */
export function bindingLabel(b: KeyBinding, mac: boolean): string {
  const p = parseBinding(b, mac);
  if (!p) return b;
  const macSym: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
  const named: Record<string, [string, string]> = {
    Enter: ["⏎", "Enter"],
    Backspace: ["⌫", "Backspace"],
    Escape: ["⎋", "Esc"],
    ArrowUp: ["↑", "↑"],
    ArrowDown: ["↓", "↓"],
    ArrowLeft: ["←", "←"],
    ArrowRight: ["→", "→"],
  };
  if (p.kind === "hold") return mac ? (macSym[p.mod] ?? p.mod) : p.mod;
  return p.chords
    .map((c) => {
      const parts = c.split("+");
      const key = parts.pop() ?? "";
      const k = named[key] ? (mac ? named[key][0] : named[key][1]) : key.length === 1 ? key.toUpperCase() : key;
      const shown = key.length === 1 && parts.length === 0 ? key : k;
      if (mac) return parts.map((m) => macSym[m] ?? m).join("") + shown;
      return [...parts.map((m) => (m === "Mod" ? "Ctrl" : m)), shown].join("+");
    })
    .join(" ");
}

/** True when a binding uses only character keys (no modifier other than Shift) — WCAG 2.1.4. */
export function isSingleKeyBinding(b: KeyBinding): boolean {
  if (b.startsWith("hold:")) return false;
  return b.split(" ").every((c) => !/(^|\+)(Mod|Ctrl|Alt)\+/.test(c) && !/^(Escape|Enter|Tab|Backspace|Arrow\w+|Home|End|Page\w+)$/.test(c));
}

/** Every set of simultaneously active scopes: the route sets, plus `global + composer|palette` (top layers). */
export function activeScopeSets(): ShortcutScope[][] {
  const sets: ShortcutScope[][] = Object.values(ROUTE_SCOPES).map((s) => [...s]);
  sets.push(["global", "composer"], ["global", "palette"]);
  return sets;
}

/**
 * Conflicts: two actions with the same canonical binding in the same scope (cross-scope overlaps are resolved by
 * precedence — top layer → route scope → global — and are intended, ux.md §8.4).
 */
export function findConflicts(defs: readonly Pick<ShortcutDef, "id" | "scope" | "keys">[], mac: boolean): KeyConflict[] {
  const seen = new Map<string, { id: string; scope: ShortcutScope }>();
  const out: KeyConflict[] = [];
  for (const d of defs) {
    for (const k of d.keys) {
      const n = normalizeBinding(k, mac);
      if (n === null) continue;
      const slot = `${d.scope}|${n}`;
      const prev = seen.get(slot);
      if (prev && prev.id !== d.id) out.push({ binding: n, ids: [prev.id, d.id], scope: d.scope });
      else seen.set(slot, { id: d.id, scope: d.scope });
    }
  }
  return out;
}

/** The default keymap as `ShortcutDef[]` (typed view of the const). */
export const DEFAULT_DEFS: readonly ShortcutDef[] = DEFAULT_KEYMAP;

/** Families excluded from remapping (ux.md §8.5). */
export const NON_REMAPPABLE = new Set(["read.chapter", "composer.intent", "map.flow", "map.pan", "inbox.choose", "palette.next", "palette.prev"]);

/** Ids whose key repeat is honoured (ux.md §8.1). */
export const REPEATABLE = new Set([
  "read.next",
  "read.prev",
  "inbox.next",
  "inbox.prev",
  "review.nextHunk",
  "review.prevHunk",
  "map.pan",
  "palette.next",
  "palette.prev",
]);
