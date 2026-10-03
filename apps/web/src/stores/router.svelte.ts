/**
 * History router (≈1 KB, contract `Router`, ux.md §2.3 / §12.5): `popstate`, link interception (one delegated
 * click listener on the app root), `history.state = {scrollY, focusBlock}` restored on back/forward. `go()`
 * resolves after the target view's first-paint mark (the view calls `painted()`).
 */
import type { Router, RouteState } from "../contract.ts";
import { hrefRoute, parseRoute } from "../shell/router.ts";

export interface HistoryEntryState {
  scrollY: number;
  focusBlock: string | null;
}

export class RouterStore implements Router {
  route = $state.raw<RouteState>({ name: "launcher" });
  /** True when the current route came from back/forward (the view restores `restored`). */
  restored = $state.raw<HistoryEntryState | null>(null);
  /**
   * Navigation counter: bumped by `go()`, back/forward and the first route — NOT by `replaceUrl()` (j / k block
   * hash, room selection, ctx mode), so a view's "arrived" logic (scroll, focus) runs once per navigation.
   */
  nav = $state(0);
  #waiters: (() => void)[] = [];
  #win: Window | null = null;

  attach(win: Window): () => void {
    this.#win = win;
    this.route = parseRoute(win.location.pathname + win.location.search + win.location.hash);
    this.nav++;
    const onPop = (e: PopStateEvent) => {
      this.restored = (e.state as HistoryEntryState | null) ?? null;
      this.route = parseRoute(win.location.pathname + win.location.search + win.location.hash);
      this.nav++;
    };
    win.addEventListener("popstate", onPop);
    return () => win.removeEventListener("popstate", onPop);
  }

  parse(url: string): RouteState {
    return parseRoute(url);
  }

  href(to: RouteState): string {
    return hrefRoute(to);
  }

  go(to: RouteState, opts: { replace?: boolean; focus?: "main" | "keep" } = {}): Promise<void> {
    const win = this.#win;
    const url = hrefRoute(to);
    if (win) {
      // remember where we were on the entry we leave
      const cur: HistoryEntryState = { scrollY: win.scrollY, focusBlock: (win.document.activeElement as HTMLElement | null)?.dataset?.b ?? null };
      win.history.replaceState(cur, "");
      if (opts.replace) win.history.replaceState(null, "", url);
      else win.history.pushState(null, "", url);
    }
    this.restored = null;
    this.focusMain = opts.focus !== "keep";
    this.route = to;
    this.nav++;
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  /** Replace the URL without re-rendering (room selection, block hash, ctx mode). */
  replaceUrl(to: RouteState): void {
    this.route = to;
    this.#win?.history.replaceState(this.#win.history.state, "", hrefRoute(to));
  }

  /** Whether the next view should move focus to `<main>`'s heading. */
  focusMain = $state(true);

  /** Called by a view after its first paint. */
  painted(): void {
    const w = this.#waiters;
    this.#waiters = [];
    for (const fn of w) fn();
  }

  /** Delegated click handler for `a[href^="/w/"]` and `a.mcite` (modifier / middle clicks go to the browser). */
  intercept(e: MouseEvent): void {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("/w/") && !href.startsWith("/settings") && href !== "/") return;
    e.preventDefault();
    void this.go(parseRoute(href));
  }
}
