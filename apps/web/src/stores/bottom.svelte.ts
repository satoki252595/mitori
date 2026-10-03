/**
 * BottomStack + toasts (ux.md §3.5, contract `BottomStack` / `ToastSpec`). Only registered elements are fixed to
 * the bottom edge (status bar, then toasts bottom-up); `bottomOf(id)` = Σ heights below + 12 px. At most
 * `toastMax` toasts, newest at the bottom, the 4th evicts the oldest, the same id replaces. Lifetimes pause while
 * the pointer or focus is inside a toast (WCAG 2.2.1).
 */
import { type BottomStack, type BottomStackKind, type ToastKind, type ToastSpec, UI_THRESHOLDS } from "../contract.ts";

const GAP = 12;
export const TTL: Record<ToastKind, number> = { info: 5000, success: 5000, undo: UI_THRESHOLDS.undoToastMs, warn: 8000, error: 0, progress: 0 };

export interface LiveToast extends ToastSpec {
  /** Remaining lifetime when paused; ms. */
  left: number;
  seq: number;
}

export class BottomStore implements BottomStack {
  items = $state.raw<readonly { id: string; kind: BottomStackKind; height: number }[]>([]);
  toasts = $state.raw<readonly LiveToast[]>([]);
  #timers = new Map<string, { handle: ReturnType<typeof setTimeout>; started: number }>();
  #seq = 0;

  set(id: string, kind: BottomStackKind, height: number): void {
    const i = this.items.findIndex((x) => x.id === id);
    if (i >= 0) {
      if (this.items[i]?.height === height) return;
      this.items = this.items.with(i, { id, kind, height });
    } else this.items = [...this.items, { id, kind, height }];
  }

  remove(id: string): void {
    this.items = this.items.filter((x) => x.id !== id);
  }

  bottomOf(id: string): number {
    let sum = 0;
    for (const it of this.items) {
      if (it.id === id) return sum === 0 ? 0 : sum + GAP;
      sum += it.height;
    }
    return sum + GAP;
  }

  /** Σ heights (for `scroll-padding-bottom`, WCAG 2.4.11). */
  get total(): number {
    return this.items.reduce((n, x) => n + x.height, 0);
  }

  toast(spec: Omit<ToastSpec, "ttlMs" | "live"> & Partial<Pick<ToastSpec, "ttlMs" | "live">>): void {
    const ttl = spec.ttlMs ?? TTL[spec.kind];
    const full: LiveToast = { ...spec, ttlMs: ttl, live: spec.live ?? (spec.kind === "error" ? "assertive" : "polite"), left: ttl, seq: ++this.#seq };
    let list = this.toasts.filter((x) => x.id !== spec.id);
    list = [...list, full];
    while (list.length > UI_THRESHOLDS.toastMax) {
      const old = list[0] as LiveToast;
      this.#clear(old.id);
      list = list.slice(1);
    }
    this.toasts = list;
    this.#clear(spec.id);
    if (ttl > 0) this.#arm(spec.id, ttl);
  }

  dismiss(id: string): void {
    this.#clear(id);
    this.toasts = this.toasts.filter((x) => x.id !== id);
  }

  pause(id: string): void {
    const t = this.#timers.get(id);
    const i = this.toasts.findIndex((x) => x.id === id);
    if (!t || i < 0) return;
    clearTimeout(t.handle);
    this.#timers.delete(id);
    const cur = this.toasts[i] as LiveToast;
    this.toasts = this.toasts.with(i, { ...cur, left: Math.max(0, cur.left - (Date.now() - t.started)) });
  }

  resume(id: string): void {
    const cur = this.toasts.find((x) => x.id === id);
    if (!cur || cur.ttlMs === 0 || this.#timers.has(id)) return;
    this.#arm(id, cur.left);
  }

  has(id: string): boolean {
    return this.toasts.some((x) => x.id === id);
  }

  #arm(id: string, ms: number): void {
    this.#timers.set(id, { handle: setTimeout(() => this.dismiss(id), ms), started: Date.now() });
  }

  #clear(id: string): void {
    const t = this.#timers.get(id);
    if (t) clearTimeout(t.handle);
    this.#timers.delete(id);
  }
}
