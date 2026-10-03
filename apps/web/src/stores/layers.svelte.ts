/**
 * One Escape stack (ux.md §3.6, contract `LayerStack`): Escape closes the open layer that comes first in
 * `LAYER_ORDER` (menu → popover → dialog → palette → … → zoom), newest first among equals, and focus returns to
 * where it was when the layer opened.
 */
import { LAYER_ORDER, type LayerKind, type LayerStack } from "../contract.ts";

interface Layer {
  kind: LayerKind;
  id: string;
  returnFocus: Element | null;
}

export class LayersStore implements LayerStack {
  layers = $state.raw<readonly Layer[]>([]);
  #closers = new Map<string, () => void>();

  /** Open a layer with its close callback (the contract `push` + the component's close action). */
  open(kind: LayerKind, id: string, onClose: () => void): void {
    this.#closers.set(id, onClose);
    this.push(kind, id);
  }

  push(kind: LayerKind, id: string): void {
    const active = typeof document === "undefined" ? null : document.activeElement;
    this.layers = [...this.layers.filter((l) => l.id !== id), { kind, id, returnFocus: active }];
  }

  has(kind: LayerKind): boolean {
    return this.layers.some((l) => l.kind === kind);
  }

  isOpen(id: string): boolean {
    return this.layers.some((l) => l.id === id);
  }

  /** The layer Escape would close. */
  top(): Layer | null {
    let best: Layer | null = null;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const l of this.layers) {
      const r = LAYER_ORDER.indexOf(l.kind);
      if (r <= bestRank) {
        best = l;
        bestRank = r;
      }
    }
    return best;
  }

  closeTop(): boolean {
    const t = this.top();
    if (!t) return false;
    this.close(t.id);
    return true;
  }

  close(id: string, opts: { restoreFocus?: boolean } = {}): void {
    const l = this.layers.find((x) => x.id === id);
    if (!l) return;
    this.layers = this.layers.filter((x) => x.id !== id);
    const fn = this.#closers.get(id);
    this.#closers.delete(id);
    fn?.();
    if (opts.restoreFocus !== false && l.returnFocus instanceof HTMLElement && l.returnFocus.isConnected) l.returnFocus.focus({ preventScroll: true });
  }

  /** Forget a layer that closed itself without Escape (no callback, no focus move). */
  drop(id: string): void {
    this.#closers.delete(id);
    this.layers = this.layers.filter((x) => x.id !== id);
  }
}
