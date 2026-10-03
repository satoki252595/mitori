/**
 * Keyboard registry (ux.md §8.1, contract `KeyRegistry`): the ONE capture-phase keydown/keyup listener on window.
 * Components never listen to keydown (exceptions: the Composer textarea and the palette input, both of which
 * call `isComposing` first). Scope = route (never pointer position); top layer (palette / composer) wins.
 */

import {
  KEY_SEQUENCE_TIMEOUT_MS,
  type KeyBinding,
  type KeyConflict,
  type KeyRegistry,
  RESERVED_KEYS,
  type RemapResult,
  type ShortcutDef,
  type ShortcutScope,
  type ShortcutWhen,
  UI_THRESHOLDS,
} from "../contract.ts";
import { isImeProcessKey } from "../shell/ime.ts";
import { isComposing } from "../shell/index.ts";
import { bindingLabel, chordOf, DEFAULT_DEFS, findConflicts, isMacPlatform, NON_REMAPPABLE, normalizeBinding, REPEATABLE } from "../shell/keys.ts";
import { mark } from "../shell/perf.ts";

export interface KeyContext {
  /** Active scopes, top-most first (e.g. `["palette", "global"]` or `["review", "read", "global"]`). */
  scopes(): readonly ShortcutScope[];
  /** Evaluate a dispatch predicate. */
  when(w: ShortcutWhen): boolean;
  /** Single-key shortcuts allowed (`UiSettings.singleKeyShortcuts`). */
  singleKeys(): boolean;
  /** keyCode 229 on a non-editable target: show the one-time IME hint. */
  imeHint(): void;
  /** `cites.showAll` hold state. */
  holdAlt(on: boolean): void;
  /** Extra filter (a modal dialog only lets `layer.close` through). */
  allow?(id: string): boolean;
  /** A bound key whose `when` predicate failed (the event passes through untouched), e.g. `e` with no target (UXP-35). */
  unmet?(id: string, when: ShortcutWhen): void;
}

/** Global actions still honoured while typing in the Composer / palette input. */
const EDITABLE_GLOBAL = new Set(["layer.close", "palette.open"]);

export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || !!el.closest?.(".cm-editor");
}

export class KeysStore implements KeyRegistry {
  readonly mac = isMacPlatform();
  pendingPrefix = $state<string | null>(null);
  #overrides = $state.raw<Record<string, readonly KeyBinding[]>>({});
  #handlers = new Map<string, Set<(e: KeyboardEvent) => void>>();
  #pendingAt = 0;
  #altTimer: ReturnType<typeof setTimeout> | null = null;
  #altOn = false;
  #ctx: KeyContext | null = null;

  get effective(): ReadonlyMap<string, readonly KeyBinding[]> {
    const m = new Map<string, readonly KeyBinding[]>();
    for (const d of DEFAULT_DEFS) m.set(d.id, this.#overrides[d.id] ?? d.keys);
    return m;
  }

  defs(): ShortcutDef[] {
    return DEFAULT_DEFS.map((d) => ({ ...d, keys: this.#overrides[d.id] ?? d.keys }));
  }

  setOverrides(map: Record<string, string>): void {
    const o: Record<string, readonly KeyBinding[]> = {};
    for (const [id, b] of Object.entries(map)) if (normalizeBinding(b, this.mac) !== null) o[id] = [b];
    this.#overrides = o;
  }

  on(id: string, fn: (e: KeyboardEvent) => void): () => void {
    let set = this.#handlers.get(id);
    if (!set) {
      set = new Set();
      this.#handlers.set(id, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }

  remap(id: string, bindings: readonly KeyBinding[]): RemapResult {
    const def = DEFAULT_DEFS.find((d) => d.id === id);
    if (!def || NON_REMAPPABLE.has(id) || bindings.length !== 1) return { ok: false, reason: "invalid" };
    const n = normalizeBinding(bindings[0] as string, this.mac);
    if (n === null) return { ok: false, reason: "invalid" };
    if (RESERVED_KEYS.some((r) => normalizeBinding(r, this.mac) === n)) return { ok: false, reason: "reserved" };
    const next = this.defs().map((d) => (d.id === id ? { ...d, keys: bindings } : d));
    const c = findConflicts(next, this.mac).find((x) => x.ids.includes(id));
    if (c) return { ok: false, reason: "conflict", conflict: c };
    this.#overrides = { ...this.#overrides, [id]: bindings };
    return { ok: true };
  }

  reset(id?: string): void {
    if (id === undefined) this.#overrides = {};
    else {
      const { [id]: _drop, ...rest } = this.#overrides;
      this.#overrides = rest;
    }
  }

  conflicts(): KeyConflict[] {
    return findConflicts(this.defs(), this.mac);
  }

  label(binding: KeyBinding): string {
    return bindingLabel(binding, this.mac);
  }

  /** First binding label of an action (for hints / tooltips). */
  hint(id: string): string {
    const b = this.effective.get(id)?.[0];
    return b ? this.label(b) : "";
  }

  /** Install the single capture listener pair. */
  attach(win: Window, ctx: KeyContext): () => void {
    this.#ctx = ctx;
    const down = (e: KeyboardEvent) => this.#onKey(e);
    const up = (e: KeyboardEvent) => this.#onKeyUp(e);
    const blur = () => this.#altOff();
    win.addEventListener("keydown", down, { capture: true });
    win.addEventListener("keyup", up, { capture: true });
    win.addEventListener("blur", blur);
    return () => {
      win.removeEventListener("keydown", down, { capture: true });
      win.removeEventListener("keyup", up, { capture: true });
      win.removeEventListener("blur", blur);
    };
  }

  #onKeyUp(e: KeyboardEvent): void {
    if (isComposing(e)) return;
    if (e.key === "Alt") {
      if (this.#altOn) e.preventDefault();
      this.#altOff();
    }
  }

  #altOff(): void {
    if (this.#altTimer) clearTimeout(this.#altTimer);
    this.#altTimer = null;
    if (this.#altOn) {
      this.#altOn = false;
      this.#ctx?.holdAlt(false);
    }
  }

  #onKey(e: KeyboardEvent): void {
    if (isComposing(e)) {
      if (isImeProcessKey(e) && !isEditable(e.target)) this.#ctx?.imeHint();
      return;
    }
    const ctx = this.#ctx;
    if (!ctx) return;
    // ⌥ hold (cites.showAll): bare Alt, not repeating, no other modifier
    if (e.key === "Alt") {
      if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.shiftKey && ctx.scopes().includes("read")) {
        this.#altTimer = setTimeout(() => {
          this.#altOn = true;
          ctx.holdAlt(true);
        }, UI_THRESHOLDS.altHoldMs);
      }
      return;
    }
    if (this.#altTimer || this.#altOn) this.#altOff();
    let chord = chordOf(e, this.mac);
    if (chord === null) return;
    let scopes = ctx.scopes();
    let editable = false;
    if (isEditable(e.target)) {
      const top = scopes[0];
      if (top === "composer" || top === "palette") {
        // inside the Composer / palette input: that layer's keys + the global Escape / ⌘K only
        scopes = [top, "global"];
        editable = true;
      } else {
        // inside other inputs: only the palette chord (browser editing keys stay the browser's)
        if (chord === normalizeBinding("Mod+K", this.mac)) this.#fire("palette.open", e);
        return;
      }
    }
    const now = performance.now();
    if (this.pendingPrefix && now - this.#pendingAt <= KEY_SEQUENCE_TIMEOUT_MS) {
      chord = `${this.pendingPrefix} ${chord}`;
      this.pendingPrefix = null;
    } else {
      this.pendingPrefix = null;
      if (chord === "g" && !this.#find("g", scopes)) {
        if (!ctx.singleKeys()) return;
        this.pendingPrefix = "g";
        this.#pendingAt = now;
        e.preventDefault();
        setTimeout(() => {
          if (this.pendingPrefix === "g" && performance.now() - this.#pendingAt >= KEY_SEQUENCE_TIMEOUT_MS) this.pendingPrefix = null;
        }, KEY_SEQUENCE_TIMEOUT_MS + 10);
        return;
      }
    }
    const def = this.#find(chord, scopes, editable);
    if (!def) return;
    if (def.singleKey && !ctx.singleKeys()) return;
    if (ctx.allow && !ctx.allow(def.id)) return;
    if (def.when && def.when !== "always" && !ctx.when(def.when)) {
      ctx.unmet?.(def.id, def.when);
      return;
    }
    if (e.repeat && !REPEATABLE.has(def.id)) {
      e.preventDefault();
      return;
    }
    this.#fire(def.id, e);
  }

  #fire(id: string, e: KeyboardEvent): void {
    const set = this.#handlers.get(id);
    if (!set || set.size === 0) return;
    e.preventDefault();
    for (const fn of [...set]) fn(e);
    mark("mitori:shortcut:handled", { trigger: e.timeStamp, id });
  }

  /** First definition in scope precedence order that has a handler or matches the chord. */
  #find(chord: string, scopes: readonly ShortcutScope[], editable = false): ShortcutDef | null {
    for (const scope of scopes) {
      for (const d of DEFAULT_DEFS) {
        if (d.scope !== scope) continue;
        if (editable && scope === "global" && !EDITABLE_GLOBAL.has(d.id)) continue;
        const keys = this.#overrides[d.id] ?? d.keys;
        for (const k of keys) {
          if (normalizeBinding(k, this.mac) === chord && (this.#handlers.get(d.id)?.size ?? 0) > 0) return d;
        }
      }
    }
    return null;
  }
}
