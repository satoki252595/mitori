/** Progressive boot: canonical server markup and immediately usable native map/Reader controllers. */
import "../shell/styles/tokens.css";
import "../shell/styles/base.css";
import "../shell/styles/prose.css";
import "../shell/styles/diagram.css";
import "../shell/styles/levels.css";
import type { ConnectionState } from "@mitori/client";
import { type BlockId, HREFS, hydratePlan, type InitialUiSnapshot, type InitialUiState, MitoriError, type SectionId } from "@mitori/core";
import type { ShortcutWhen } from "../contract.ts";
import { VisibleClock } from "../gen/visibility.ts";
import { PlanController } from "../map/plan-dom.ts";
import { decorateBlock } from "../reader/decorate.ts";
import { mountNativeReader, type NativeReaderAction } from "../reader/native.ts";
import type { NativeReaderState } from "../reader/native-state.ts";
import { indexOutline } from "../reader/outline.ts";
import { buildPage } from "../reader/page.ts";
import { completeLogin } from "../shell/auth.ts";
import { cookieValue, EFFORT_CODES, EFFORT_OF_CODE, LEVEL_CODES, parseUiCookieFields, uiCookieString } from "../shell/cookie.ts";
import { FIRST_RUN_KEY, firstRunLevel, welcomeKey } from "../shell/firstrun.ts";
import { fmtLocShort } from "../shell/fmt.ts";
import { setCatalog } from "../shell/i18n.ts";
import { t } from "../shell/index.ts";
import { KeysController } from "../shell/keys-controller.ts";
import { makeClients } from "../shell/net/clients.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { markRead, readMapOf } from "../shell/reading.ts";
import { parseRoute } from "../shell/router.ts";
import { getItem, getJson, readCookies, STORAGE_KEYS, setItem, setJson, writeCookie } from "../shell/storage.ts";

const root = document.getElementById("app")!;
let snapshot: InitialUiSnapshot | null = null;
let settingsVersion = 0;
let connectedWorkspace: string | null = null;
let state: InitialUiState;
let requestEpoch = 0;
let uiRevision = 0;
let actionEpoch = 0;
let enhanced = false;
let enhancementModule: Promise<typeof import("../shell/main.ts")> | null = null;
let enhancementStarted = false;
let receiveEnhancement: ((request: EnhanceRequest) => void) | null = null;
let pendingHover = false;
let pendingFocus = false;
let pendingImeHint = false;
let projectWorkspace: string | null = null;
let reserveProject = true;
let disclosure: { key: string; clock: VisibleClock } | null = null;
let stopDisclosure = () => {};
let reader: ReturnType<typeof mountNativeReader> | null = null;
let plan: PlanController | null = null;
let disconnectView = () => {};
let connectionTarget: (next: ConnectionState) => void = () => {};
let connection: ConnectionState = { kind: "connecting" };
const clients = makeClients((next) => {
  connection = next;
  connectionTarget(next);
  if (enhanced) return;
  const dot = root.querySelector<HTMLElement>(".live-dot");
  if (dot) dot.dataset.s = next.kind;
  root.querySelector(".w-daemon")?.setAttribute("aria-label", t(`statusbar.conn.${next.kind}`));
  if (next.kind === "stopped" || next.kind === "auth_expired" || next.kind === "version_mismatch") void enhance();
});
const keys = new KeysController();
const offKeys = keys.attach(window, {
  scopes: () => (snapshot?.map ? ["map", "global"] : ["read", "global"]),
  when: (when: ShortcutWhen) =>
    when === "targetOrSelection"
      ? !!reader?.capture().focused || !!document.getSelection()?.toString().trim()
      : when === "citeFocused"
        ? !!document.activeElement?.closest("a.mcite,a.fcite")
        : true,
  singleKeys: () => snapshot?.settings.settings.ui.singleKeyShortcuts ?? true,
  imeHint: () => {
    if (getItem("session", STORAGE_KEYS.imeHint)) return;
    pendingImeHint = true;
    void enhance();
  },
  holdAlt: (on) => document.documentElement.classList.toggle("show-cites", on),
});

const catalogs = import.meta.glob<Record<string, string>>("../../i18n/{shell,map,reader}.{ja,en}.json", { eager: true, import: "default" });
async function catalog(lang: "ja" | "en") {
  // Native map/Reader need only these namespaces. Settings and feature catalogs arrive with enhancement.
  setCatalog(
    lang,
    Object.assign(
      {},
      ...Object.entries(catalogs)
        .filter(([path]) => path.endsWith(`.${lang}.json`))
        .map(([, data]) => data),
    ),
  );
}
function persistUi() {
  showLevel();
  document.documentElement.lang = state.lang;
  if (state.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.theme;
  writeCookie(
    uiCookieString({
      v: 1,
      lv: LEVEL_CODES[state.level],
      lg: state.lang,
      ...(state.theme !== "system" ? { th: state.theme === "dark" ? ("d" as const) : ("l" as const) } : {}),
      ...(state.railCollapsed ? { rc: 1 as const } : {}),
      ...(state.codeWidth ? { cw: state.codeWidth } : {}),
      ...(state.effort ? { ef: EFFORT_CODES[state.effort] } : {}),
    }),
  );
}
function showLevel() {
  document.documentElement.dataset.level = state.level;
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="mitori-level"]')) {
    input.checked = input.value === state.level;
    input.closest("label")?.classList.toggle("on", input.checked);
  }
}
function replaceBlock(block: BlockId) {
  history.replaceState(history.state, "", `${location.pathname}${location.search}#${block}`);
  state.url = location.pathname + location.search + location.hash;
}
function nativeUrl() {
  return location.pathname + location.search + location.hash;
}
function viewKey(url: string) {
  const route = parseRoute(url);
  if (route.name === "map") return `map:${route.ws}`;
  if (route.name === "doc") return `doc:${route.ws}:${snapshot ? (indexOutline(snapshot.outline).pageOf.get(route.section) ?? route.section) : route.section}`;
  return route.name;
}

async function loadView(initialReader?: NativeReaderState, initial?: Partial<InitialUiState> & { firstRun?: boolean }): Promise<void> {
  const route = parseRoute(nativeUrl());
  if (route.name !== "map" && route.name !== "doc") return void (await enhance());
  const epoch = ++requestEpoch;
  const revision = uiRevision;
  const ui = {
    ...(initial ?? state),
    url: nativeUrl(),
    width: document.documentElement.clientWidth,
    read: readMapOf(route.ws, (initial ?? state).course ?? "_any"),
    welcomeDismissed: !!getItem("local", welcomeKey(route.ws)),
    mac: keys.mac,
  };
  const view = await clients.api.call("GET /ws/:ws/ui", { params: { ws: route.ws }, query: { url: ui.url, width: ui.width, ui: JSON.stringify(ui) } });
  if (enhanced || epoch !== requestEpoch || nativeUrl() !== ui.url) return;
  await catalog(view.snapshot.ui.lang);
  if (enhanced || epoch !== requestEpoch || nativeUrl() !== ui.url) return;
  if (revision !== uiRevision) {
    view.snapshot.ui.level = state.level;
    if (state.effort) view.snapshot.ui.effort = state.effort;
  }
  const camera = plan ? { ...plan.cam } : null;
  // A same-page refresh must preserve reading done while its server view was loading.
  if (initialReader) {
    const live = reader?.capture();
    if (live?.page === initialReader.page && live.ws === initialReader.ws) initialReader = live;
  }
  disconnectView();
  stopDisclosure();
  snapshot = view.snapshot;
  settingsVersion = snapshot.settings.version;
  state = snapshot.ui;
  persistUi();
  root.innerHTML = view.html;
  showLevel();
  keys.setOverrides(snapshot.settings.settings.ui.keymap);
  const ws = snapshot.status.info.key;
  // The server cannot read browser storage. Keep the first-visit width for this page, including a later full hand-off.
  if (projectWorkspace !== ws) {
    projectWorkspace = ws;
    reserveProject = !getJson("local", STORAGE_KEYS.proj(ws));
  }
  root.querySelector(".hdr .proj")?.classList.toggle("reserve", reserveProject);
  const ix = indexOutline(snapshot.outline);
  const node = route.name === "doc" ? ix.nodes.get(ix.pageOf.get(route.section) ?? route.section) : null;
  document.title = `${node?.title ?? t("title.map")} — mitori · ${snapshot.status.info.name}`;
  for (const verdict of ["inferred", "stale", "unsupported", "verified", "cited", "human-verified"])
    document.documentElement.style.setProperty(`--t-verdict-${verdict}`, JSON.stringify(t(`verdict.${verdict}`)));
  if (route.name === "doc") {
    const main = root.querySelector<HTMLElement>("main")!;
    const page = buildPage(ix, ix.pageOf.get(route.section) ?? route.section, (id) => snapshot!.sections.find((s) => s.section.id === id));
    reader = mountNativeReader({
      root: main,
      page,
      sourceBlocks: snapshot.sections.flatMap((s) => s.blocks),
      ws,
      level: state.level,
      lang: snapshot.outline.manifest.primaryLang,
      placeholderLabel: t("reader.placeholder.generate"),
      ...(route.block ? { block: route.block } : {}),
      ...(initialReader ? { initial: initialReader } : {}),
      pages: ix.pages,
      navigate: (section) => void navigate(HREFS.doc(ws, section)),
      replaceBlock,
      text: {
        citeEnd: (n) => t("reader.citeEnd", { n }),
        verifyLabel: t("reader.checkClaim"),
        codeHref: (p, a, b) => HREFS.code(ws, p as never, a as never, b as never),
      },
      enhance: (action, captured) => void enhance({ readerAction: action, reader: captured }),
      cancelEnhance: (via) => {
        if (via === "hover" ? pendingHover : pendingFocus) actionEpoch++;
      },
      refresh: (block, captured) => {
        replaceBlock(block);
        void loadView(captured);
      },
      setLevel: (level) => {
        uiRevision++;
        state.level = level;
        persistUi();
        saveLevel(level);
      },
      read: (section) => {
        if (markRead(ws, section, new Date().toISOString())) {
          state.read = readMapOf(ws, "_any");
          refresh();
        }
      },
    });
    disconnectView = () => {
      reader?.destroy();
      reader = null;
    };
    if (!initialReader && !route.block) {
      window.scrollTo(0, 0);
      main.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    }
    setItem("session", STORAGE_KEYS.lastPage(ws), page.page);
    markAfterPaint("mitori:section:rendered");
    void fillReader(epoch, ws);
  } else if (snapshot.map?.plan && snapshot.map.svg) {
    const map = snapshot.map;
    const model = hydratePlan(map.plan!);
    const host = root.querySelector<HTMLElement>(".stage-host")!;
    plan = new PlanController(
      host,
      model,
      {
        title: t("map.aria.plan"),
        roomLabel: (r) => t("map.aria.room", { zone: r.zoneLabel, room: r.label, files: r.files, n: r.threads }),
        roomHref: (r) => HREFS.map(ws, r.id as never),
        files: (n) => t("map.room.files", { n }),
      },
      "plan-desc",
      {
        onselect: (id) => {
          const url = new URL(location.href);
          if (id) url.searchParams.set("room", id);
          else url.searchParams.delete("room");
          state.url = url.pathname + url.search;
          history.replaceState(history.state, "", state.url);
          void loadView();
        },
        onopen: (id) => {
          const room = model.byId.get(id);
          if (!room) return;
          if (room.external && room.path) {
            void enhance({ href: HREFS.code(ws, room.path as never) });
            return;
          }
          const section = room.section ?? [...ix.nodes.values()].find((n) => room.module && n.module === room.module)?.id ?? "s5";
          void navigate(HREFS.doc(ws, section));
        },
        onstage: (stage) => {
          const buttons = root.querySelectorAll<HTMLButtonElement>(".zoombar .seg button");
          buttons.forEach((b, i) => {
            b.setAttribute("aria-pressed", String(["Z0", "Z1", "Z2"][i] === stage));
          });
        },
        onhover: (id, rect) => {
          const tooltip = root.querySelector<HTMLElement>("[data-native-map-tooltip]");
          const room = id ? model.byId.get(id) : null;
          if (!tooltip) return;
          tooltip.hidden = !room || !rect || id === route.room;
          if (tooltip.hidden || !room || !rect) return;
          tooltip.replaceChildren();
          tooltip.style.left = `${Math.max(8, rect.left)}px`;
          tooltip.style.top = `${rect.bottom + 6}px`;
          for (const [tag, value, mono] of [
            ["b", room.label, false],
            ["span", room.summary ?? "", false],
            ["span", t("map.room.static", { files: room.files, loc: fmtLocShort(room.loc) }), true],
            ["span", room.topSymbols.join(" · "), true],
          ] as const) {
            if (!value) continue;
            const el = document.createElement(tag);
            el.textContent = value;
            el.dataset.userContent = "";
            if (mono) el.className = "mono";
            tooltip.append(el);
          }
        },
      },
      map.diagram.kind === "floorplan" && !map.fallback,
      map.svg!,
    );
    if (camera) plan.restoreCamera(camera);
    else if (route.zoom) plan.zoomToStage(route.zoom);
    if (route.flow) plan.setFlow(snapshot.sections.find((s) => s.section.id === route.flow)?.mapFlow ?? null);
    const pins: Record<string, number> = {};
    for (const thread of snapshot.threads) {
      const id = thread.anchor.diagram?.node;
      if (id && thread.state !== "resolved" && thread.state !== "draft") pins[id] = (pins[id] ?? 0) + 1;
    }
    plan.setPins(pins);
    const ro = new ResizeObserver(() => plan?.resize());
    ro.observe(host);
    disconnectView = () => {
      ro.disconnect();
      plan?.destroy();
      plan = null;
    };
    markAfterPaint("mitori:map:painted");
    if (route.room) {
      plan.select(route.room, false);
      const rect = plan.roomRect(route.room);
      const stage = root.querySelector(".stage");
      if (rect && stage) {
        const bounds = stage.getBoundingClientRect();
        root.querySelector(".room-float")?.classList.toggle("left", rect.left + rect.width / 2 > bounds.left + bounds.width / 2);
      }
      markAfterPaint("mitori:room:card");
    }
    if (route.textView) void enhance();
  }
  fitHeader();
  if (state.effort) applyEffort(state.effort);
  observeDisclosure();
  const daemon = root.querySelector<HTMLElement>(".w-daemon");
  if (daemon) {
    daemon.setAttribute("aria-label", t(`statusbar.conn.${connection.kind}`));
    const dot = daemon.querySelector<HTMLElement>(".live-dot");
    if (dot) dot.dataset.s = connection.kind;
    const text = [...daemon.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    if (text) text.textContent = t("statusbar.daemon", { endpoint: location.host });
  }
  markAfterPaint("mitori:toc:painted");
  if (snapshot.status.scan.summary) markAfterPaint("mitori:scan:summary", { ws, files: snapshot.status.scan.summary.files });
  // MapPage's scan effect does not run during SSR; keep the same next-frame marker for the rendered facts tiles.
  if (route.name === "map" && snapshot.status.scan.summary && root.querySelector(".facts .grid")) markAfterPaint("mitori:facts:painted");
  if (connectedWorkspace !== ws) {
    connectedWorkspace = ws;
    clients.sse.connect(ws);
  }
  // Reuse the Shell's once-per-session notice and accessible toast lifetime; ordinary cold views stay native.
  const usageWindow = snapshot.usage?.window;
  if ((usageWindow?.billing === "overage" || usageWindow?.overage?.active) && !getItem("session", STORAGE_KEYS.hint("overage")) && !enhancementModule)
    void enhance();
}

function observeDisclosure() {
  if (!snapshot) return;
  const ws = snapshot.status.info.key;
  const row = root.querySelector<HTMLElement>("[data-testid=disclosure]");
  if (row) {
    const key = `${ws}:${snapshot.status.genEngine ?? snapshot.settings.settings.defaultGenEngine}:${snapshot.engines.map((e) => `${e.engine}:${e.plan ?? ""}`).join(",")}:${Object.values(
      snapshot.estimates ?? {},
    )
      .map((e) => e?.model ?? "")
      .join(",")}:${row.textContent}`;
    if (disclosure?.key !== key) disclosure = { key, clock: new VisibleClock() };
    const clock = disclosure.clock;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) clock.entry(e.isIntersecting && e.intersectionRatio >= 0.9, performance.now(), () => new Date().toISOString());
      },
      { threshold: [0, 0.9, 1] },
    );
    io.observe(row);
    stopDisclosure = () => {
      io.disconnect();
      clock.entry(false, performance.now(), () => new Date().toISOString());
    };
  } else {
    disclosure = null;
    stopDisclosure = () => {};
  }
}

function applyEffort(effort: NonNullable<InitialUiState["effort"]>) {
  const card = root.querySelector<HTMLTemplateElement>(`template[data-native-effort="${effort}"]`);
  const side = root.querySelector(".side");
  if (!card || !side) return false;
  stopDisclosure();
  side.replaceChildren(card.content.cloneNode(true));
  return true;
}

/** Same canonical range API as the enhanced Reader; unchanged hashes fill only missing bodies. */
async function fillReader(epoch: number, ws: InitialUiSnapshot["status"]["info"]["key"]) {
  const current = reader;
  const sections = snapshot?.sections ?? [];
  for (const section of sections) {
    let from = 0;
    while (from < section.blocks.length) {
      if (epoch !== requestEpoch || reader !== current || enhanced) return;
      const next = section.blocks.findIndex((b, i) => i >= from && !b.html);
      if (next < 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (epoch !== requestEpoch || reader !== current || enhanced) return;
      const view = await clients.api
        .call("GET /ws/:ws/doc/sections/:section", { params: { ws, section: section.section.id }, query: { from: next, limit: 150, outline: false } })
        .catch(() => null);
      if (epoch !== requestEpoch || reader !== current || enhanced || !view) return;
      if (!current?.fill(view.blocks)) {
        refresh();
        return;
      }
      from = next + 150;
    }
  }
}

let levelTimer: ReturnType<typeof setTimeout> | null = null;
let levelPending = false;
function saveLevel(level: InitialUiState["level"]) {
  levelPending = true;
  if (levelTimer) clearTimeout(levelTimer);
  levelTimer = setTimeout(() => {
    levelTimer = null;
    void clients.api
      .call("PATCH /settings", { params: {}, body: { version: snapshot?.settings.version ?? settingsVersion, patch: { ui: { readerLevel: level } } } })
      .then((v) => {
        settingsVersion = v.version;
        if (snapshot) snapshot.settings = v;
        if (state.level === level) levelPending = false;
      })
      .catch(() => {});
  }, 1000);
}

type EnhanceRequest = { readerAction?: NativeReaderAction; reader?: NativeReaderState; key?: KeyboardEvent; selector?: string; href?: string };
function displayAction(request: EnhanceRequest): boolean {
  const action = request.readerAction;
  return action?.kind === "gutter" || ((action?.kind === "cite" || action?.kind === "term") && action.via !== "click");
}
function pendingAction(request: EnhanceRequest) {
  pendingHover =
    request.readerAction?.kind === "gutter" ||
    ((request.readerAction?.kind === "cite" || request.readerAction?.kind === "term") && request.readerAction.via === "hover");
  pendingFocus = (request.readerAction?.kind === "cite" || request.readerAction?.kind === "term") && request.readerAction.via === "focus";
}
/** Proposal controls mount through the existing lazy LoopRoot/ProposalLayer after the full Shell's tick. */
async function proposalControl(selector: string): Promise<HTMLElement | null> {
  const current = () => document.querySelector<HTMLElement>(selector);
  if (current()) return current();
  return new Promise((resolve) => {
    const finish = () => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(current());
    };
    const observer = new MutationObserver(() => {
      if (current()) finish();
    });
    const timer = setTimeout(finish, 5000);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
async function enhance(request: EnhanceRequest = {}) {
  if (enhanced) return;
  if (receiveEnhancement) return receiveEnhancement(request);
  let epoch = ++actionEpoch;
  pendingAction(request);
  const at = nativeUrl();
  const identity = viewKey(at);
  enhancementModule ??= import("../shell/main.ts");
  const full = await enhancementModule;
  if (epoch !== actionEpoch || viewKey(nativeUrl()) !== identity || enhancementStarted) return;
  const snap = snapshot;
  let captured: NativeReaderState | undefined;
  let scrollY = window.scrollY;
  const initial: Parameters<typeof full.boot>[0] = snap
    ? {
        snapshot: { ...snap, ui: { ...state, url: nativeUrl() } },
        clients,
        onConnection: (listener) => {
          connectionTarget = listener;
        },
      }
    : undefined;
  // The native DOM stays visible while boot imports the full view. A later cite focus must win over an older display action.
  let latestCiteFocus: NativeReaderAction | null = request.readerAction?.kind === "cite" && request.readerAction.via === "focus" ? request.readerAction : null;
  const captureFocus = (event: FocusEvent) => {
    if (!displayAction(request)) return;
    const cite = (event.target as Element | null)?.closest<HTMLElement>("a.mcite,a.fcite");
    const block = cite?.closest<HTMLElement>(".blk[data-b]")?.dataset.b as BlockId | undefined;
    if (!cite || !block || !root.contains(cite)) return;
    latestCiteFocus = { kind: "cite", cite: cite.dataset.cite ?? "", blob: cite.dataset.blob ?? "", block, via: "focus" };
  };
  window.addEventListener("focusin", captureFocus, true);
  enhancementStarted = true;
  // Keep the existing native action/keyboard matcher alive while the full view loads. Explicit actions win over display-only focus/hover.
  receiveEnhancement = (next) => {
    if (!displayAction(request) && displayAction(next)) return;
    const nextAction = next.readerAction;
    const nextFocus = (nextAction?.kind === "cite" || nextAction?.kind === "term") && nextAction.via === "focus";
    const focusedCite = (document.activeElement as Element | null)?.closest<HTMLElement>("a.mcite,a.fcite");
    if (displayAction(next) && !nextFocus && focusedCite && root.contains(focusedCite)) return;
    request = next;
    epoch = ++actionEpoch;
    if (nextAction?.kind === "cite" && nextAction.via === "focus") latestCiteFocus = nextAction;
    else if (!displayAction(next) || (nextAction?.kind === "term" && nextAction.via === "focus")) latestCiteFocus = null;
    pendingAction(request);
  };
  let stores: Awaited<ReturnType<typeof full.boot>>;
  try {
    stores = await full.boot(initial, () => {
      if (epoch !== actionEpoch || viewKey(nativeUrl()) !== identity) return false;
      const liveReader = reader?.capture();
      captured = liveReader ? { ...liveReader, ...(request.reader?.selection ? { selection: request.reader.selection } : {}) } : request.reader;
      scrollY = window.scrollY;
      if (initial) {
        initial.snapshot = { ...(snapshot ?? initial.snapshot), ui: { ...state, url: nativeUrl() } };
        if (captured) initial.reader = captured;
        if (levelPending) initial.pendingLevel = state.level;
        if (plan) initial.mapCamera = { ...plan.cam };
        if (disclosure) initial.disclosureClock = disclosure.clock;
      }
      if (levelTimer) {
        clearTimeout(levelTimer);
        levelTimer = null;
      }
      disconnectView();
      stopDisclosure();
      offKeys();
      root.removeEventListener("click", click);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("resize", fitHeader);
      window.removeEventListener("pagehide", persistProject);
      if (refreshTimer) clearTimeout(refreshTimer);
      for (const off of sseOffs) off();
      enhanced = true;
      return true;
    });
  } finally {
    receiveEnhancement = null;
    if (!enhanced) enhancementStarted = false;
    window.removeEventListener("focusin", captureFocus, true);
  }
  if (!stores || epoch !== actionEpoch || viewKey(nativeUrl()) !== identity) return;
  stores.session.connection = connection;
  if (pendingImeHint) {
    pendingImeHint = false;
    if (!stores.ui.imeHintShown && !getItem("session", STORAGE_KEYS.imeHint)) {
      stores.ui.imeHintShown = true;
      setItem("session", STORAGE_KEYS.imeHint, "1");
      stores.bottom.toast({ id: "hint.imeOn", kind: "info", key: "hint.imeOn" });
    }
  }
  window.scrollTo(0, captured?.scrollY ?? scrollY);
  const readerAction = latestCiteFocus ?? request.readerAction;
  if (readerAction && captured) window.dispatchEvent(new CustomEvent("mitori:native-reader", { detail: { action: readerAction, state: captured } }));
  if (request.href) void stores.router.go(parseRoute(request.href));
  if (request.selector) {
    if (request.selector.startsWith("[data-proposal=")) {
      const { loadExtensions } = await import("../shell/ext.ts");
      await loadExtensions(stores);
    }
    const el = request.selector.startsWith("[data-proposal=") ? await proposalControl(request.selector) : root.querySelector<HTMLElement>(request.selector);
    if (epoch !== actionEpoch || viewKey(nativeUrl()) !== identity) return;
    el?.focus({ preventScroll: true });
    el?.click();
  }
  if (request.key) {
    const e = request.key;
    const key = new KeyboardEvent("keydown", {
      key: e.key,
      code: e.code,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(key, "timeStamp", { value: e.timeStamp });
    window.dispatchEvent(key);
  }
}

async function navigate(url: string, restoring = false) {
  actionEpoch++;
  if (!restoring) {
    history.replaceState({ scrollY: window.scrollY, focusBlock: reader?.capture().focused ?? null }, "");
    history.pushState(null, "", url);
  }
  const route = parseRoute(url);
  if (route.name === "map" || route.name === "doc") {
    state.url = url;
    await loadView();
    if (restoring && history.state?.scrollY) window.scrollTo(0, history.state.scrollY);
  } else await enhance({ href: url });
}
function pop() {
  void navigate(nativeUrl(), true);
}
function hash() {
  const route = parseRoute(nativeUrl());
  if (route.name === "doc" && route.block && reader) {
    state.url = nativeUrl();
    reader.jump(route.block);
  }
}
function fitHeader() {
  const header = root.querySelector<HTMLElement>(".hdr");
  const mid = header?.querySelector<HTMLElement>(".hdr-m");
  const tabs = header?.querySelector<HTMLElement>(".tabs");
  if (!header || !mid || !tabs) return;
  delete header.dataset.tight;
  if (mid.clientWidth < tabs.scrollWidth) header.querySelector(".proj")?.classList.remove("reserve");
  for (let n = 1; n <= 2 && mid.clientWidth < tabs.scrollWidth; n++) header.dataset.tight = String(n);
}
function persistProject() {
  const status = snapshot?.status;
  const head = status?.snapshot?.commit?.slice(0, 7);
  if (status?.info.name && head) setJson("local", STORAGE_KEYS.proj(status.info.key), { name: status.info.name, head, tag: status.profile?.head?.tag ?? null });
}
function selectorFor(el: HTMLElement): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset.act) return `${el.closest("header.hdr") ? ".hdr" : el.closest(".rail") ? ".rail" : ".status"} [data-act="${CSS.escape(el.dataset.act)}"]`;
  const parts: string[] = [];
  let current: HTMLElement | null = el;
  while (current && current !== root) {
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      return parts.join(" > ");
    }
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return null;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(current) + 1})`);
    current = parent;
  }
  return current === root ? `#app > ${parts.join(" > ")}` : null;
}
function click(e: MouseEvent) {
  if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const el = (e.target as Element).closest<HTMLElement>("a,button,input");
  if (!el) return;
  const proposal = el.closest<HTMLElement>(".native-proposal[data-proposal]");
  if (proposal && el.matches("button.ok,button.no")) {
    e.preventDefault();
    const id = CSS.escape(proposal.dataset.proposal!);
    void enhance({ selector: `[data-proposal="${id}"] .pp button.${el.matches(".ok") ? "ok" : "no"}` });
    return;
  }
  const anchor = el.closest<HTMLAnchorElement>("a[href]");
  const href = anchor?.getAttribute("href");
  if (href?.startsWith("#b_") && reader) {
    e.preventDefault();
    const block = href.slice(1) as BlockId;
    replaceBlock(block);
    reader.jump(block);
    return;
  }
  if (href?.startsWith("/w/") || href === "/" || href?.startsWith("/settings")) {
    e.preventDefault();
    void navigate(href);
    return;
  }
  if (el.matches('input[name="mitori-effort"]')) {
    const effort = (el as HTMLInputElement).value;
    const side = root.querySelector(".side");
    if (side && (effort === "overview" || effort === "standard" || effort === "complete") && applyEffort(effort)) {
      uiRevision++;
      state.effort = effort;
      if (snapshot) snapshot.ui.effort = effort;
      persistUi();
      observeDisclosure();
      side.querySelector<HTMLInputElement>(`input[value="${effort}"]`)?.focus({ preventScroll: true });
      markAfterPaint("mitori:estimate:updated");
      return;
    }
  }
  if (el.matches(".zoombar button") && plan) {
    e.preventDefault();
    const stages = [...root.querySelectorAll(".zoombar .seg button")];
    const at = stages.indexOf(el);
    if (at >= 0) plan.zoomToStage(["Z0", "Z1", "Z2"][at] as never);
    else {
      const i = [...root.querySelectorAll(".zoombar > .icon-btn")].indexOf(el);
      if (i === 2) plan.fit();
      else plan.stepZoom(i === 0 ? -1 : 1);
    }
    return;
  }
  if (el.tagName === "BUTTON" || el.tagName === "INPUT") {
    const selector = selectorFor(el);
    if (selector) {
      e.preventDefault();
      void enhance({ selector });
    }
  }
}
root.addEventListener("click", click);
window.addEventListener("popstate", pop);
window.addEventListener("hashchange", hash);
window.addEventListener("resize", fitHeader);
// The enhanced Header persists itself; native pages remember the last shown chip when this visit ends.
window.addEventListener("pagehide", persistProject);
for (const def of keys.defs())
  keys.on(def.id, (e) => {
    if (def.id === "layer.close") {
      actionEpoch++;
      const menu = root.querySelector<HTMLDetailsElement>("details.menu[open]");
      if (menu) {
        menu.open = false;
        menu.querySelector<HTMLElement>("summary")?.focus();
        return;
      }
      const route = parseRoute(nativeUrl());
      if (plan && route.name === "map") {
        if (route.room) {
          const url = new URL(location.href);
          url.searchParams.delete("room");
          history.replaceState(history.state, "", url.pathname + url.search);
          void loadView();
        } else if (plan.k > 1.02) plan.zoomOutOne();
      }
      return;
    }
    if (reader && (def.id.startsWith("read.") || def.id.startsWith("level.") || ["act.comment", "act.explain", "act.fix", "peek.pin"].includes(def.id))) {
      if (!reader.action(def.id, e)) void enhance({ key: e });
      return;
    }
    if (plan) {
      if (def.id === "map.zoomIn") return plan.stepZoom(1);
      if (def.id === "map.zoomOut") return plan.stepZoom(-1);
      if (def.id === "map.fit") return plan.fit();
      if (def.id === "map.flow") {
        const section = indexOutline(snapshot!.outline).nodes.get("s3")?.children[Number(/^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1] ?? 0) - 1] as
          | SectionId
          | undefined;
        if (section) {
          const url = new URL(location.href);
          if (url.searchParams.get("flow") === section) url.searchParams.delete("flow");
          else url.searchParams.set("flow", section);
          history.replaceState(history.state, "", url.pathname + url.search);
          void loadView();
        }
        return;
      }
      if (def.id === "map.pan") {
        const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
        if (plan.focusNeighbour(dir)) return;
        const step = e.shiftKey ? 192 : 48;
        plan.panBy(e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0, e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0);
        return;
      }
    }
    if (def.id === "pane.toc") {
      root.querySelector<HTMLElement>(".toc a[aria-current=page],.toc a")?.focus();
      return;
    }
    void enhance({ key: e });
  });
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const refresh = () => {
  if (enhanced || refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadView(reader?.capture());
  }, 100);
};
const sseOffs = [
  "resync",
  "workspace.updated",
  "settings.updated",
  "scan.done",
  "index.changed",
  "map.updated",
  "doc.outline",
  "doc.block.upsert",
  "doc.block.removed",
  "doc.proposal.upsert",
  "doc.proposal.removed",
  "doc.freshness",
  "doc.claims",
  "gen.run",
  "gen.task",
  "thread.upsert",
  "thread.removed",
  "job.upsert",
  "engines.updated",
  "usage.updated",
].map((type) => clients.sse.on(type as never, refresh));
sseOffs.push(
  clients.sse.on("doc.block.partial", (event) => {
    reader?.partial(event.section, event.text);
  }),
);
sseOffs.push(
  clients.sse.on("doc.block.upsert", (event) => {
    reader?.partial(event.block.section, "");
  }),
);
sseOffs.push(
  clients.sse.on("doc.freshness", (event) => {
    const ids = new Set(event.blocks);
    for (const section of snapshot?.sections ?? [])
      for (const block of section.blocks)
        if (ids.has(block.id)) {
          block.freshness = event.freshness;
          for (const mb of root.querySelectorAll<HTMLElement>(`.blk[data-b="${CSS.escape(block.id)}"] .mb`)) mb.dataset.fresh = event.freshness;
        }
  }),
);
sseOffs.push(
  clients.sse.on("doc.claims", (event) => {
    const changed = new Map(event.claims.map((c) => [c.id, c]));
    for (const section of snapshot?.sections ?? [])
      for (const block of section.blocks) {
        if (!block.claimViews.some((c) => changed.has(c.id))) continue;
        block.claimViews = block.claimViews.map((c) => ({ ...c, ...changed.get(c.id) }));
        for (const wrapper of root.querySelectorAll<HTMLElement>(`.blk[data-b="${CSS.escape(block.id)}"]`))
          decorateBlock(wrapper, block, state.level, {
            citeEnd: (n) => t("reader.citeEnd", { n }),
            verifyLabel: t("reader.checkClaim"),
            codeHref: (p, a, b) => HREFS.code(snapshot!.status.info.key, p as never, a as never, b as never),
          });
      }
  }),
);

async function boot() {
  await completeLogin(clients.api, location, history);
  const route = parseRoute(nativeUrl());
  if (route.name !== "map" && route.name !== "doc") {
    await enhance();
    return;
  }
  const fields = parseUiCookieFields(cookieValue(readCookies()));
  const seen = getItem("local", FIRST_RUN_KEY) !== null;
  // The canonical view already includes current settings. Let its renderer apply those defaults in one request.
  const initial = {
    firstRun: fields.lv === undefined && !seen,
    railCollapsed: fields.rc === 1,
    codeWidth: fields.cw ?? null,
    course: getItem("session", STORAGE_KEYS.path(route.ws)),
    ...(fields.ef ? { effort: EFFORT_OF_CODE[fields.ef] } : {}),
  };
  try {
    await loadView(undefined, initial);
    const settings = snapshot?.settings;
    if (settings) {
      const level = firstRunLevel({ cookieHasLevel: fields.lv !== undefined, seen, current: settings.settings.ui.readerLevel });
      if (level) void clients.api.call("PATCH /settings", { params: {}, body: { version: settings.version, patch: { ui: { readerLevel: level } } } });
      setItem("local", FIRST_RUN_KEY, new Date().toISOString().slice(0, 10));
    }
  } catch (err) {
    if (err instanceof MitoriError && err.code === "E_UNSUPPORTED") {
      await enhance();
      return;
    }
    await catalog(state?.lang ?? fields.lg ?? "ja");
    const main = document.createElement("main");
    main.id = "main";
    main.setAttribute("role", "alert");
    main.textContent = t("app.loading");
    root.replaceChildren(main);
    throw err;
  }
}
void boot();
