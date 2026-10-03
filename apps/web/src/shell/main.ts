/**
 * Entry chunk (ux.md §3.2, §12.1): create the stores once, finish a pending browser login, load the active
 * language's catalog (modulepreloaded by the head script), then replace the static skeleton with the Shell in
 * the same task (identical box sizes ⇒ no layout shift).
 */
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/prose.css";
import "./styles/levels.css";
import { mount } from "svelte";
import { createStores } from "../stores/app.svelte.ts";
import { completeLogin } from "./auth.ts";
import { cookieValue, parseUiCookieFields } from "./cookie.ts";
import { setCatalog, setMissingKeyReporter, setSettingsLang } from "./i18n.ts";
import { installReactiveCatalog, loadCatalog } from "./i18n-cell.svelte.ts";
import { detectUiLang } from "./index.ts";
import { makeClients } from "./net/clients.ts";
import Shell from "./Shell.svelte";
import { readCookies } from "./storage.ts";

declare const __MITORI_TEST__: boolean;

/** Upper bound for waiting on `GET /settings` when the cookie carries no language (local daemon: a few ms). */
const SETTINGS_WAIT_MS = 400;

async function boot(): Promise<void> {
  installReactiveCatalog();
  if (typeof __MITORI_TEST__ !== "undefined" && __MITORI_TEST__) setMissingKeyReporter((k) => console.error(`[i18n-missing] ${k}`));
  let stores: ReturnType<typeof createStores> | null = null;
  const { api, sse } = makeClients((st) => {
    if (stores) stores.session.connection = st;
  });
  const cookieLang = parseUiCookieFields(cookieValue(readCookies())).lg ?? null;
  const guess = detectUiLang();
  const guessCat = loadCatalog(guess);
  await completeLogin(api, location, history);
  stores = createStores(api, sse, () => new Worker(new URL("../palette/worker.ts", import.meta.url), { type: "module", name: "palette" }));
  // no language in the cookie (first visit): the server setting decides before the first paint, so the UI never
  // re-renders in another language (CLS 0). Bounded wait; the Shell joins this same request.
  let lang = guess;
  if (!cookieLang) {
    const settings = stores.session.loadSettings();
    const v = await Promise.race([settings, new Promise<null>((r) => setTimeout(() => r(null), SETTINGS_WAIT_MS))]);
    if (v) {
      setSettingsLang(v.settings.ui.lang);
      stores.prefs.reconcile(v);
      stores.doc.level = stores.prefs.level;
      lang = v.settings.ui.lang;
    }
  }
  setCatalog(lang, await (lang === guess ? guessCat : loadCatalog(lang)));
  stores.prefs.lang = lang;
  const target = document.getElementById("app");
  if (!target) return;
  target.textContent = "";
  mount(Shell, { target, props: { stores } });
}

void boot();
