/**
 * UI preferences (theme, reader level, language, single-key shortcuts, rail, code-pane width, last effort):
 * boot from the `mitori_ui` cookie (already applied by the head script), reconcile with `GET /settings` (server
 * wins, cookie rewritten — ux.md §3.2-6), persist with `PATCH /settings` (debounced 1 s) + the cookie.
 */
import type { ApiClient } from "@mitori/client";
import { type DeepPartial, type Effort, type GlobalSettings, MitoriError, type ReaderLevel, type SettingsView, type UiLang } from "@mitori/core";
import type { UiCookie } from "../contract.ts";
import { cookieValue, EFFORT_CODES, EFFORT_OF_CODE, LEVEL_CODES, LEVEL_OF_CODE, parseUiCookieFields, uiCookieString } from "../shell/cookie.ts";
import { readCookies, writeCookie } from "../shell/storage.ts";

export type Theme = "system" | "light" | "dark";

export class PrefsState {
  theme = $state<Theme>("system");
  lang = $state<UiLang>("ja");
  level = $state<ReaderLevel>("standard");
  singleKeys = $state(true);
  railCollapsed = $state(false);
  codeWidth = $state<number | null>(null);
  effort = $state<Effort | null>(null);
  editor = $state<"vscode" | "cursor" | "none">("none");
  #pending: DeepPartial<GlobalSettings> = {};
  #timer: ReturnType<typeof setTimeout> | null = null;
  #version = 0;
  private readonly api: ApiClient;

  constructor(api: ApiClient) {
    this.api = api;
    const f = parseUiCookieFields(cookieValue(readCookies()));
    if (f.th) this.theme = f.th === "d" ? "dark" : "light";
    if (f.lv) this.level = LEVEL_OF_CODE[f.lv];
    if (f.lg) this.lang = f.lg;
    if (f.rc !== undefined) this.railCollapsed = f.rc === 1;
    if (f.cw !== undefined) this.codeWidth = f.cw;
    if (f.ef) this.effort = EFFORT_OF_CODE[f.ef];
  }

  /** A local change is waiting for its debounced `PATCH /settings`. */
  get pending(): boolean {
    return this.#timer !== null;
  }

  /** Apply the server settings (server wins) and rewrite the cookie. */
  reconcile(view: SettingsView | null): void {
    if (!view) return;
    this.#version = view.version;
    const ui = view.settings.ui;
    this.theme = ui.theme;
    this.lang = ui.lang;
    this.level = ui.readerLevel;
    this.singleKeys = ui.singleKeyShortcuts;
    this.editor = ui.editor;
    this.writeCookie();
  }

  cookie(): UiCookie {
    const c: UiCookie = { v: 1, lv: LEVEL_CODES[this.level], lg: this.lang };
    if (this.theme !== "system") c.th = this.theme === "dark" ? "d" : "l";
    if (this.railCollapsed) c.rc = 1;
    if (this.codeWidth !== null) c.cw = this.codeWidth;
    if (this.effort) c.ef = EFFORT_CODES[this.effort];
    return c;
  }

  writeCookie(): void {
    writeCookie(uiCookieString(this.cookie()));
  }

  setTheme(t: Theme): void {
    this.theme = t;
    this.writeCookie();
    this.#patch({ ui: { theme: t } });
  }

  setLang(l: UiLang): void {
    this.lang = l;
    this.writeCookie();
    this.#patch({ ui: { lang: l } });
  }

  setLevel(l: ReaderLevel): void {
    this.level = l;
    this.writeCookie();
    this.#patch({ ui: { readerLevel: l } });
  }

  setSingleKeys(on: boolean): void {
    this.singleKeys = on;
    this.#patch({ ui: { singleKeyShortcuts: on } });
  }

  setEffort(e: Effort): void {
    this.effort = e;
    this.writeCookie();
  }

  setCodeWidth(px: number): void {
    this.codeWidth = px;
    this.writeCookie();
  }

  setRailCollapsed(on: boolean): void {
    this.railCollapsed = on;
    this.writeCookie();
  }

  /** Immediate settings patch (privacy acks): no debounce. */
  async patchNow(patch: DeepPartial<GlobalSettings>): Promise<boolean> {
    try {
      const v = await this.api.call("PATCH /settings", { params: {}, body: { version: this.#version, patch } });
      this.#version = v.version;
      return true;
    } catch (err) {
      if (MitoriError.is(err, "E_CONFLICT")) {
        // re-read the version and retry once with our own change
        try {
          const cur = await this.api.call("GET /settings", { params: {} });
          this.#version = cur.version;
          const v = await this.api.call("PATCH /settings", { params: {}, body: { version: this.#version, patch } });
          this.#version = v.version;
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  #patch(p: DeepPartial<GlobalSettings>): void {
    this.#pending = merge(this.#pending, p);
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      const patch = this.#pending;
      this.#pending = {};
      this.#timer = null;
      void this.patchNow(patch);
    }, 1000);
  }
}

function merge<T extends object>(a: T, b: T): T {
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" ? merge(cur as object, v as object) : v;
  }
  return out as T;
}
