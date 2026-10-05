/**
 * The head inline script (ux.md §3.2): runs before first paint so theme / level / language / pane widths come
 * from the `mitori_ui` cookie with zero layout shift. vite.config.ts inlines `bootHead` + `parseUiCookieFields`
 * via `Function.prototype.toString` (minified; the daemon hashes the result into the CSP), so this function must
 * be self-contained: only its parameters and browser globals.
 */
import type { UiCookieFields } from "./cookie.ts";

export interface HeadChunks {
  /** `/assets/i18n-ja-<hash>.js` etc. */
  ja: string;
  en: string;
  map: string;
  reader: string;
}

export function bootHead(d: Document, parse: (raw: string | null) => UiCookieFields, _chunks: HeadChunks): void {
  const h = d.documentElement;
  let lg: "ja" | "en" = "ja";
  try {
    const m = /(?:^|;\s*)mitori_ui=([^;]*)/.exec(d.cookie);
    const c = parse(m ? (m[1] ?? null) : null);
    h.dataset.level = c.lv === "n" ? "newcomer" : c.lv === "e" ? "expert" : "standard";
    if (c.th) h.dataset.theme = c.th === "d" ? "dark" : "light";
    if (c.cw) h.style.setProperty("--ctx-w-code", `${c.cw}px`);
    if (c.rc === 1) h.dataset.rail = "collapsed";
    lg = c.lg ?? (/^ja\b/i.test(navigator.language || "ja") ? "ja" : "en");
  } catch (_e) {
    h.dataset.level = "standard";
  }
  h.lang = lg;
  try {
    const p = location.pathname;
    const view = /^\/w\/[^/]+\/?$/.test(p) ? "map" : /^\/w\/[^/]+\/(doc|code|review)\//.test(p) ? "doc" : p === "/" ? "launcher" : "other";
    h.dataset.boot = view;
    // Canonical initial markup is rendered by the daemon; route modules load on their first enhanced action.
  } catch (_e) {
    /* preload is an optimisation */
  }
  requestAnimationFrame(() => {
    try {
      performance.mark("mitori:shell:painted");
    } catch (_e) {
      /* marks are best effort */
    }
  });
}
