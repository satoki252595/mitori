/**
 * UI preferences (theme, reader level, language, single-key shortcuts, rail, code-pane width, last effort):
 * boot from the `mitori_ui` cookie (already applied by the head script), reconcile with `GET /settings` (server
 * wins, cookie rewritten — ux.md §3.2-6), persist with `PATCH /settings` (debounced 1 s) + the cookie.
 *
 * A change still waiting for its PATCH survives a reload (NC-14: switching to English and reloading within the
 * debounce came back in Japanese — the server, which had not heard of it, won): the pending patch is kept in
 * `localStorage` until the server took it, and a new page sends it before it lets the server's copy win.
 */
import type { ApiClient } from "@mitori/client";
import { type DeepPartial, type Effort, type GlobalSettings, MitoriError, type ReaderLevel, type SettingsView, type UiLang } from "@mitori/core";
import type { UiCookie } from "../contract.ts";
import { cookieValue, EFFORT_CODES, EFFORT_OF_CODE, LEVEL_CODES, LEVEL_OF_CODE, parseUiCookieFields, uiCookieString } from "../shell/cookie.ts";
import { getJson, readCookies, removeItem, setJson, writeCookie } from "../shell/storage.ts";

/** The unsent settings patch (a reload inside the debounce must not lose it). */
export const PENDING_PREFS_KEY = "mitori:prefs:pending";

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
  #writes: Promise<boolean> = Promise.resolve(true);
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
    // a patch the previous page could not send: send it first (and hold the server's copy back until then) — as
    // soon as the settings version is known (`noteVersion`; a guessed version would only earn a 409), at the latest in 2 s
    const kept = getJson<DeepPartial<GlobalSettings>>("local", PENDING_PREFS_KEY);
    if (kept && typeof kept === "object") {
      this.#keptWaiting = true;
      this.#patch(kept, 2000);
    }
  }

  #keptWaiting = false;

  /** The server's settings version (boot / every `GET /settings`): a kept patch waiting for it goes now. */
  noteVersion(version: number): void {
    this.#version = version;
    if (this.#keptWaiting) {
      this.#keptWaiting = false;
      this.#patch({}, 0);
    }
  }

  /** A local change is queued, in flight, or awaiting retry after a failed `PATCH /settings`. */
  get pending(): boolean {
    return Object.keys(this.#pending).length > 0;
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

  /**
   * `immediate`: also PATCH right away (the first-run level, NC-08): the server's copy wins at the next boot, so a
   * reload inside the 1 s debounce would otherwise bring the old level back. The debounced patch still runs, so the
   * boot's own (older) settings view is not re-applied over it meanwhile (`pending`).
   */
  setLevel(l: ReaderLevel, opts: { immediate?: boolean } = {}): void {
    this.level = l;
    this.writeCookie();
    this.#patch({ ui: { readerLevel: l } });
    if (opts.immediate) void this.patchNow({ ui: { readerLevel: l } });
  }

  /** `⇧O` target (UiSettings.editor, §16 R21). */
  setEditor(e: "vscode" | "cursor" | "none"): void {
    this.editor = e;
    this.#patch({ ui: { editor: e } });
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
  patchNow(patch: DeepPartial<GlobalSettings>): Promise<boolean> {
    // Serialize every write, including immediate privacy acks, so an older retry cannot overwrite a newer edit.
    this.#writes = this.#writes.then(() => this.#sendPatch(patch));
    return this.#writes;
  }

  async #sendPatch(patch: DeepPartial<GlobalSettings>): Promise<boolean> {
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

  #patch(p: DeepPartial<GlobalSettings>, delayMs = 1000): void {
    this.#pending = merge(this.#pending, p);
    setJson("local", PENDING_PREFS_KEY, this.#pending);
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      const patch = this.#pending;
      this.#timer = null;
      this.#keptWaiting = false;
      void this.patchNow(patch).then((ok) => {
        // Keep failed writes and newer edits together until that exact snapshot is acknowledged.
        if (ok && this.#pending === patch) {
          this.#pending = {};
          if (JSON.stringify(getJson("local", PENDING_PREFS_KEY)) === JSON.stringify(patch)) removeItem("local", PENDING_PREFS_KEY);
        }
      });
    }, delayMs);
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
