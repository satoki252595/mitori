/** Canonical Svelte server rendering, compiled and embedded with the release assets. */
import { createApiClient, type SseClient } from "@mitori/client";
import { API_PREFIX, type InitialUiRenderer, type InitialUiSnapshot, type InitialUiState, MitoriError } from "@mitori/core";
import { render } from "svelte/server";
import { UI_THRESHOLDS } from "../contract.ts";
import { EFFORTS } from "../gen/efforts.ts";
import MapPage from "../map/MapPage.svelte";
import * as initialSide from "../map/side.ts";
import { indexOutline, pageSections } from "../reader/outline.ts";
import { welcomeKey } from "../shell/firstrun.ts";
import { setCatalog } from "../shell/i18n.ts";
import { parseRoute } from "../shell/router.ts";
import Shell from "../shell/Shell.svelte";
import { STORAGE_KEYS, withServerStorage } from "../shell/storage.ts";
import { createStores } from "../stores/app.svelte.ts";
import InitialReader from "./InitialReader.svelte";
import { seedInitial } from "./seed.ts";

const catalogs = import.meta.glob<Record<string, string>>("../../i18n/*.json", { eager: true, import: "default" });
const catalog = (lang: "ja" | "en") =>
  Object.assign(
    {},
    ...Object.entries(catalogs)
      .filter(([path]) => path.endsWith(`.${lang}.json`))
      .map(([, data]) => data),
  ) as Record<string, string>;
const noSse = { connect() {}, on: () => () => {}, close() {} } as unknown as SseClient;

function invalid(field: string): never {
  throw new MitoriError("E_INVALID_INPUT", "invalid initial UI state", { params: { field } });
}
function state(query: URLSearchParams, defaults: InitialUiSnapshot["settings"]): InitialUiState {
  const url = query.get("url") ?? invalid("url");
  const width = Number(query.get("width") ?? 1440);
  if (!Number.isInteger(width) || width < 320 || width > 8192) invalid("width");
  const raw = query.get("ui") ?? "{}";
  if (raw.length > 16_384) invalid("ui");
  let given: Partial<InitialUiState>;
  try {
    given = JSON.parse(raw);
  } catch {
    invalid("ui");
  }
  if (!given || Array.isArray(given) || typeof given !== "object") invalid("ui");
  const d = defaults.settings.ui;
  const level = given.level ?? d.readerLevel;
  const lang = given.lang ?? d.lang;
  const theme = given.theme ?? d.theme;
  if (!["newcomer", "standard", "expert"].includes(level)) invalid("level");
  if (lang !== "ja" && lang !== "en") invalid("lang");
  if (!["system", "light", "dark"].includes(theme)) invalid("theme");
  const codeWidth = given.codeWidth ?? null;
  if (codeWidth !== null && (!Number.isInteger(codeWidth) || codeWidth < 420 || codeWidth > 900)) invalid("codeWidth");
  const read = given.read ?? {};
  if (!read || typeof read !== "object" || Array.isArray(read) || Object.keys(read).length > 512) invalid("read");
  for (const [id, at] of Object.entries(read)) if (!/^s\d+(?:\/[a-zA-Z0-9_.-]+)*$/.test(id) || typeof at !== "string" || at.length > 40) invalid("read");
  const course = given.course ?? null;
  if (course !== null && (typeof course !== "string" || !/^[a-z0-9_-]{1,64}$/.test(course))) invalid("course");
  if (given.railCollapsed !== undefined && typeof given.railCollapsed !== "boolean") invalid("railCollapsed");
  if (given.mac !== undefined && typeof given.mac !== "boolean") invalid("mac");
  if (given.effort !== undefined && !EFFORTS.includes(given.effort)) invalid("effort");
  if (given.welcomeDismissed !== undefined && typeof given.welcomeDismissed !== "boolean") invalid("welcomeDismissed");
  return {
    url,
    width,
    level,
    lang,
    theme,
    codeWidth,
    railCollapsed: given.railCollapsed ?? false,
    course,
    read,
    welcomeDismissed: given.welcomeDismissed ?? false,
    mac: given.mac ?? false,
    ...(given.effort ? { effort: given.effort } : {}),
  };
}

export const renderInitialUi: InitialUiRenderer = async (query, get, estimate) => {
  const api = createApiClient({
    base: API_PREFIX,
    auth: { scheme: "session", token: () => null },
    client: { kind: "web", version: "initial" },
    fetch: (async (input, init) => {
      if (init?.method !== "GET") invalid("method");
      const value = await get(String(input).slice(API_PREFIX.length));
      return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch,
  });
  const settings = await api.call("GET /settings", { params: {} });
  const ui = state(query, settings);
  const route = parseRoute(ui.url);
  if (route.name !== "map" && route.name !== "doc") invalid("url");
  const ws = route.ws;
  const [status, outline, daemon, usage, engines, threads, jobs, inbox, proposals] = await Promise.all([
    api.call("GET /ws/:ws", { params: { ws } }),
    api.call("GET /ws/:ws/doc", { params: { ws } }),
    api.call("GET /daemon", { params: {} }).catch(() => null),
    api.call("GET /usage/summary", { params: {}, query: { range: "today" } }).catch(() => null),
    api.call("GET /engines", { params: {} }).catch(() => []),
    api
      .call("GET /ws/:ws/threads", { params: { ws }, query: { limit: 200 } })
      .then((p) => p.items)
      .catch(() => []),
    api
      .call("GET /ws/:ws/jobs", { params: { ws }, query: { limit: 200 } })
      .then((p) => p.items)
      .catch(() => []),
    api
      .call("GET /ws/:ws/inbox", { params: { ws }, query: { limit: 200 } })
      .then((p) => p.items)
      .catch(() => []),
    api.call("GET /ws/:ws/doc/proposals", { params: { ws }, query: { state: "pending" } }).catch(() => []),
  ]);
  const snapshot: InitialUiSnapshot = { ui, settings, status, outline, daemon, usage, engines, threads, jobs, inbox, proposals, map: null, sections: [] };
  if (route.name === "map") {
    snapshot.map = await api.call("GET /ws/:ws/map", { params: { ws }, query: { svg: true, lang: ui.lang } });
    if (outline.manifest.generatedAt)
      snapshot.sections.push(
        await api.call("GET /ws/:ws/doc/sections/:section", { params: { ws, section: "s0" }, query: { from: 0, limit: UI_THRESHOLDS.blockWindow * 3 } }),
      );
    else {
      const engine = status.genEngine ?? settings.settings.defaultGenEngine;
      snapshot.estimates = Object.fromEntries(
        await Promise.all(
          EFFORTS.map(async (effort) => [
            effort,
            await estimate(effort, engine).catch((err) => {
              snapshot.estimateError = MitoriError.from(err).toData();
              return undefined;
            }),
          ]),
        ),
      );
    }
    const ix = indexOutline(outline);
    const flowIds = route.room ? (ix.nodes.get("s3")?.children ?? []) : route.flow ? [route.flow] : [];
    for (const section of new Set(flowIds))
      snapshot.sections.push(
        await api.call("GET /ws/:ws/doc/sections/:section", { params: { ws, section }, query: { from: 0, limit: UI_THRESHOLDS.blockWindow * 3 } }),
      );
  } else {
    const ix = indexOutline(outline);
    const page = ix.pageOf.get(route.section) ?? route.section;
    for (const section of pageSections(ix, page)) {
      const ids = ix.nodes.get(section)?.blocks ?? [];
      const from = Math.max(0, (route.block ? ids.indexOf(route.block) : 0) - UI_THRESHOLDS.blockWindow);
      snapshot.sections.push(
        await api.call("GET /ws/:ws/doc/sections/:section", { params: { ws, section }, query: { from, limit: UI_THRESHOLDS.blockWindow * 3 } }),
      );
    }
  }
  const stores = createStores(api, noSse, () => {
    throw new Error("SSR does not start a browser Worker");
  });
  seedInitial(stores, snapshot);
  Object.defineProperty(stores.keys, "mac", { value: ui.mac });
  const values = new Map<string, string>();
  values.set(`local:${STORAGE_KEYS.read(ws, "_any")}`, JSON.stringify(ui.read));
  if (ui.course) values.set(`session:${STORAGE_KEYS.path(ws)}`, ui.course);
  if (ui.welcomeDismissed) values.set(`local:${welcomeKey(ws)}`, "1");
  const html = withServerStorage(values, () => {
    setCatalog(ui.lang, catalog(ui.lang));
    return render(Shell, {
      props: {
        stores,
        primed: true,
        initialView: route.name === "map" ? MapPage : InitialReader,
        initialViewProps: (route.name === "map" ? { initialSide, native: true } : { native: true }) as unknown as Record<string, never>,
      },
    }).body;
  });
  return { html, snapshot };
};
