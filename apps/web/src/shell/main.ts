/**
 * Entry chunk (ux.md §3.2, §12.1): create the stores once, finish a pending browser login, load the active
 * language's catalog (modulepreloaded by the head script), then replace the static skeleton with the Shell in
 * the same task (identical box sizes ⇒ no layout shift).
 */
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/prose.css";
import "./styles/diagram.css";
import "./styles/levels.css";
import type { InitialUiSnapshot } from "@mitori/core";
import { mount, tick } from "svelte";
import { seedInitial } from "../initial/seed.ts";
import { restoreNativeSelection } from "../reader/native.ts";
import type { NativeReaderState } from "../reader/native-state.ts";
import { createStores } from "../stores/app.svelte.ts";
import { completeLogin } from "./auth.ts";
import { cookieValue, parseUiCookieFields } from "./cookie.ts";
import { FIRST_RUN_KEY, firstRunLevel } from "./firstrun.ts";
import { setMissingKeyReporter, setSettingsLang } from "./i18n.ts";
import { installReactiveCatalog, loadCatalog, switchLang } from "./i18n-cell.svelte.ts";
import { detectUiLang } from "./index.ts";
import { makeClients } from "./net/clients.ts";
import Shell from "./Shell.svelte";
import { getItem, readCookies, setItem } from "./storage.ts";

declare const __MITORI_TEST__: boolean;

/** Upper bound for waiting on `GET /settings` when the cookie carries no language (local daemon: a few ms). */
const SETTINGS_WAIT_MS = 400;

export async function boot(initial?: {
  snapshot: InitialUiSnapshot;
  reader?: NativeReaderState;
  pendingLevel?: InitialUiSnapshot["ui"]["level"];
  clients?: ReturnType<typeof makeClients>;
  mapCamera?: import("../contract.ts").MapCamera;
  disclosureClock?: import("../gen/visibility.ts").VisibleClock;
  onConnection?: (listener: (state: import("@mitori/client").ConnectionState) => void) => void;
}): Promise<ReturnType<typeof createStores> | null> {
  installReactiveCatalog();
  if (typeof __MITORI_TEST__ !== "undefined" && __MITORI_TEST__) setMissingKeyReporter((k) => console.error(`[i18n-missing] ${k}`));
  let stores: ReturnType<typeof createStores> | null = null;
  const { api, sse } =
    initial?.clients ??
    makeClients((st) => {
      if (stores) stores.session.connection = st;
    });
  if (initial) {
    const snap = initial.snapshot;
    stores = createStores(api, sse, () => new Worker(new URL("../palette/worker.ts", import.meta.url), { type: "module", name: "palette" }));
    seedInitial(stores, snap);
    // A native level change still awaiting its PATCH must hold back the older settings view during hand-off.
    if (initial.pendingLevel) stores.prefs.setLevel(initial.pendingLevel);
    for (const partial of initial.reader?.partials ?? []) {
      stores.doc.partial(partial.section, partial.text);
      const value = stores.doc.streaming.get(partial.section);
      if (value) stores.doc.streaming.set(partial.section, { ...value, reservedPx: Math.max(value.reservedPx, partial.reservedPx) });
    }
    stores.session.connection = sse.state;
    const liveStores = stores;
    initial.onConnection?.((state) => {
      liveStores.session.connection = state;
    });
    await switchLang(snap.ui.lang);
    const isMap = stores.router.route.name === "map";
    const [{ default: View }, side] = await Promise.all([
      isMap ? import("../map/MapPage.svelte") : import("../reader/ReaderPage.svelte"),
      isMap ? Promise.all([import("../map/side.ts"), import("./i18n-cell.svelte.ts").then((m) => m.ensureNs("gen"))]).then(([m]) => m) : Promise.resolve(null),
    ]);
    const target = document.getElementById("app");
    if (!target) return null;
    target.textContent = "";
    mount(Shell, {
      target,
      props: {
        stores,
        primed: true,
        initialView: View,
        initialViewProps: (isMap
          ? { initialSide: side, initialCamera: initial.mapCamera, initialDisclosureClock: initial.disclosureClock }
          : { initialReader: initial.reader }) as unknown as Record<string, never>,
      },
    });
    await tick();
    const main = target.querySelector<HTMLElement>("main");
    if (main && initial.reader) restoreNativeSelection(main, initial.reader.selection);
    return stores;
  }
  const cookieFields = parseUiCookieFields(cookieValue(readCookies()));
  const cookieLang = cookieFields.lg ?? null;
  const guess = detectUiLang();
  // the guessed language's base catalog is modulepreloaded by the head script: start its import now
  void loadCatalog(guess);
  await completeLogin(api, location, history);
  stores = createStores(api, sse, () => new Worker(new URL("../palette/worker.ts", import.meta.url), { type: "module", name: "palette" }));
  // no language in the cookie (first visit): the server setting decides before the first paint, so the UI never
  // re-renders in another language (CLS 0). Bounded wait; the Shell joins this same request.
  let lang = guess;
  if (!cookieLang) {
    const settings = stores.session.loadSettings();
    const v = await Promise.race([settings, new Promise<null>((r) => setTimeout(() => r(null), SETTINGS_WAIT_MS))]);
    if (v) stores.prefs.noteVersion(v.version);
    // an unsent change of the previous page (prefs PENDING_PREFS_KEY) is newer than the server's copy
    if (v && !stores.prefs.pending) {
      setSettingsLang(v.settings.ui.lang);
      stores.prefs.reconcile(v);
      stores.doc.level = stores.prefs.level;
      lang = v.settings.ui.lang;
    }
  }
  await switchLang(lang);
  stores.prefs.lang = lang;
  // NC-08: a browser's first visit reads at 「初めて」 (and so the 5-minute course), decided before the first mount
  const first = firstRunLevel({ cookieHasLevel: cookieFields.lv !== undefined, seen: getItem("local", FIRST_RUN_KEY) !== null, current: stores.prefs.level });
  setItem("local", FIRST_RUN_KEY, new Date().toISOString().slice(0, 10));
  if (first) {
    stores.prefs.setLevel(first, { immediate: true });
    stores.doc.level = first;
    document.documentElement.dataset.level = first;
  }
  const target = document.getElementById("app");
  if (!target) return null;
  target.textContent = "";
  mount(Shell, { target, props: { stores } });
  return stores;
}
