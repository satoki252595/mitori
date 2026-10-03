<!--
  Shell (contract `ShellProps`, ux.md §3): header, banner, the route view (lazy chunks), status bar, toasts,
  overlays (palette / help / stopped), live regions. All DOM bridges (html[data-level|data-theme], lang,
  CSS badge labels, ResizeObserver width) live here as effects — stores stay DOM-free (ux.md §12.2-5).
-->
<script lang="ts">
import { HREFS, type RepoPath, type WorkspaceKey } from "@mitori/core";
import { type Component, onMount, untrack } from "svelte";
import { type AppMode, ROUTE_SCOPES, type ShortcutScope, type ShortcutWhen } from "../contract.ts";
import { applySettings, provideStores, type Stores } from "../stores/app.svelte.ts";
import { wireSse } from "../stores/sse.ts";
import Banner from "./Banner.svelte";
import { copyText } from "./clipboard.ts";
import { loadExtensions, type UiExtension } from "./ext.ts";
import { fmtDeltaImpl, fmtDurationImpl, fmtTokensImpl, fmtUsdImpl } from "./fmt.ts";
import Header from "./Header.svelte";
import { switchLang } from "./i18n-cell.svelte.ts";
import { t } from "./index.ts";
import { mark } from "./perf.ts";
import Rich from "./Rich.svelte";
import { viewKind } from "./router.ts";
import StatusBar from "./StatusBar.svelte";
import { getItem, STORAGE_KEYS, setItem } from "./storage.ts";
import Toasts from "./Toasts.svelte";

let { stores, mode = "daemon" }: { stores: Stores; mode?: AppMode } = $props();
// the store root is created once in main.ts and never replaced
const s = untrack(() => stores);
provideStores(s);

const route = $derived(s.router.route);
const kind = $derived(viewKind(route));

// ---------------------------------------------------------------- lazy route views (chunks: map, reader, gen, settings, launcher)
const LOADERS: Record<string, () => Promise<{ default: Component<Record<string, never>> }>> = {
  launcher: () => import("./Launcher.svelte"),
  map: () => import("../map/views.ts").then((m) => ({ default: m.MapPage })),
  doc: () => import("../reader/views.ts").then((m) => ({ default: m.ReaderPage })),
  code: () => import("../reader/views.ts").then((m) => ({ default: m.CodeView })),
  settings: () => import("../settings/SettingsPage.svelte"),
  gen: () => import("../gen/GenPage.svelte"),
};
let View = $state.raw<Component<Record<string, never>> | null>(null);
let viewKey = $state<string | null>(null);
let ext = $state.raw<UiExtension | null>(null);

function loaderKey(): string | null {
  switch (route.name) {
    case "launcher":
      return "launcher";
    case "map":
      return "map";
    case "doc":
    case "review":
      return "doc";
    case "code":
      return "code";
    case "settings":
    case "wsSettings":
      return "settings";
    case "gen":
    case "decisions":
      return "gen";
    default:
      return null;
  }
}

$effect(() => {
  const key = loaderKey();
  untrack(() => {
    if (key === viewKey) return;
    if (key === null) {
      viewKey = null;
      View = null;
      return;
    }
    const load = LOADERS[key];
    if (!load) return;
    void load().then((m) => {
      if (loaderKey() === key) {
        View = m.default;
        viewKey = key;
      }
    });
  });
});

// ---------------------------------------------------------------- workspace switching (+ SSE re-scope)
let current: WorkspaceKey | null | undefined;
$effect(() => {
  const ws = "ws" in route ? route.ws : null;
  untrack(() => enter(ws));
});

function enter(ws: WorkspaceKey | null) {
  if (ws === current) return;
  current = ws;
  s.doc.reset();
  s.map.reset();
  s.gen.reset();
  s.review.reset();
  s.inbox.reset();
  s.sse.connect(ws);
  if (!ws) {
    s.workspace.key = null;
    s.workspace.status = null;
    return;
  }
  void s.workspace.open(ws).then(() => {
    const st = s.workspace.status;
    if (st?.gen) s.gen.applyRun(st.gen);
    if (st?.genEngine) s.gen.engine = st.genEngine;
  });
  void s.doc.loadOutline();
  void s.review.load();
  void s.inbox.load();
  void s.session.loadEngines();
}

// ---------------------------------------------------------------- redirects (reviewNext, glossary, thread)
$effect(() => {
  const r = route;
  untrack(() => {
    if (r.name === "reviewNext") {
      // a deep link arrives before the jobs: decide once they are loaded
      void s.review.whenLoaded().then(() => {
        if (s.router.route !== r) return;
        const job = s.review.oldestReady();
        void s.router.go(job ? { name: "review", ws: r.ws, job } : { name: "inbox", ws: r.ws, view: "mine" }, { replace: true });
      });
    } else if (r.name === "glossary") {
      void s.router.go({ name: "doc", ws: r.ws, section: "s12" }, { replace: true });
    } else if (r.name === "thread") {
      void Promise.all([s.review.detail(r.th), s.doc.whenOutline()]).then(
        ([th]) => {
          const a = th.anchor;
          const block = a.doc?.block;
          const sec = block ? s.doc.index?.blockSection.get(block) : undefined;
          if (sec && block) void s.router.go({ name: "doc", ws: r.ws, section: sec, block, thread: r.th }, { replace: true });
          else if (a.code) void s.router.go({ name: "code", ws: r.ws, path: a.code.path, range: { start: a.code.start, end: a.code.end } }, { replace: true });
          else void s.router.go({ name: "map", ws: r.ws }, { replace: true });
        },
        () => void s.router.go({ name: "inbox", ws: r.ws, view: "all" }, { replace: true }),
      );
    }
  });
});

// ---------------------------------------------------------------- DOM bridges
$effect(() => {
  const h = document.documentElement;
  const level = s.doc.level;
  if (h.dataset.level !== level) {
    h.dataset.level = level;
    requestAnimationFrame(() => mark("mitori:level:applied"));
  }
});
$effect(() => {
  const h = document.documentElement;
  const th = s.prefs.theme;
  if (th === "system") delete h.dataset.theme;
  else h.dataset.theme = th;
});
$effect(() => {
  document.documentElement.classList.toggle("show-cites", s.ui.showCites);
});
$effect(() => {
  const lang = s.prefs.lang;
  untrack(() => {
    void switchLang(lang).then(() => {
      document.documentElement.lang = lang;
      const st = document.documentElement.style;
      for (const v of ["inferred", "stale", "unsupported", "verified", "cited", "human-verified"])
        st.setProperty(`--t-verdict-${v}`, JSON.stringify(t(`verdict.${v}`)));
    });
  });
});
$effect(() => {
  document.documentElement.style.setProperty("--bottom-pad", `${s.bottom.total}px`);
});
$effect(() => {
  // tab title: {page} — mitori · {workspace}
  const name = s.workspace.status?.info.name;
  const page = route.name === "doc" && s.doc.index ? (s.doc.index.nodes.get(route.section)?.title ?? "") : t(`title.${route.name}`);
  document.title = name ? `${page} — mitori · ${name}` : `${page} — mitori`;
});
$effect(() => {
  // remember the last opened page for the 設計書 tab (ux.md §2.3-2) and the last file for `g c`
  if (route.name === "doc" && s.doc.index) setItem("session", STORAGE_KEYS.lastPage(route.ws), s.doc.index.pageOf.get(route.section) ?? route.section);
  if (route.name === "code") setItem("session", STORAGE_KEYS.lastFile(route.ws), route.path);
});

// ---------------------------------------------------------------- keyboard context
function scopes(): readonly ShortcutScope[] {
  const top = s.layers.top();
  if (top?.kind === "palette" || top?.kind === "composer") return [top.kind, "global"];
  if (top?.kind === "dialog") return ["global"];
  const list = ROUTE_SCOPES[kind] as readonly ShortcutScope[];
  return [...list.filter((x) => x !== "global"), "global"];
}

function when(w: ShortcutWhen): boolean {
  switch (w) {
    case "readyJobExists":
      return s.review.oldestReady() !== null;
    case "undoAvailable":
      return s.bottom.toasts.some((x) => x.kind === "undo");
    case "inputEmpty":
      return s.palette.query === "";
    case "citeFocused":
      return !!document.activeElement?.closest?.("a.mcite, a.fcite") || !!document.querySelector("a.mcite.on, a.fcite.on");
    case "roomFocused":
      return !!document.activeElement?.closest?.("[data-node]");
    case "targetOrSelection": {
      const sel = document.getSelection();
      return (!!sel && sel.toString().trim().length >= 1) || !!document.querySelector(".blk.focus");
    }
    case "pendingThreads":
      for (const th of s.review.threads.values()) if (th.state === "open") return true;
      return false;
    default:
      return true;
  }
}

/** A key with no target (`c` / `e` / `f` / `p` without a focused block or selection): one hint per session (UXP-35). */
function unmet(_id: string, w: ShortcutWhen) {
  if (w !== "targetOrSelection" || getItem("session", STORAGE_KEYS.hint("noTarget"))) return;
  setItem("session", STORAGE_KEYS.hint("noTarget"), "1");
  s.bottom.toast({ id: "hint.noTarget", kind: "info", key: "hint.noTarget" });
}

function imeHint() {
  if (s.ui.imeHintShown || getItem("session", STORAGE_KEYS.imeHint)) return;
  s.ui.imeHintShown = true;
  setItem("session", STORAGE_KEYS.imeHint, "1");
  s.bottom.toast({ id: "hint.imeOn", kind: "info", key: "hint.imeOn" });
}

function navTo(target: "map" | "doc" | "inbox" | "code" | "review" | "settings") {
  const ws = s.workspace.key;
  if (target === "settings") return void s.router.go(ws ? { name: "wsSettings", ws } : { name: "settings" });
  if (!ws) return;
  if (target === "map") return void s.router.go({ name: "map", ws });
  if (target === "inbox") return void s.router.go({ name: "inbox", ws, view: "mine" });
  if (target === "review") return void s.router.go({ name: "reviewNext", ws });
  if (target === "doc") {
    const last = getItem("session", STORAGE_KEYS.lastPage(ws));
    return void s.router.go({ name: "doc", ws, section: (last as "s0" | null) ?? "s0" });
  }
  if (target === "code") {
    // the last file opened in this tab; none yet ⇒ the palette in path mode (`:`)
    const path = getItem("session", STORAGE_KEYS.lastFile(ws));
    const r = path ? s.router.parse(HREFS.code(ws, path as RepoPath)) : null;
    if (r?.name === "code") return void s.router.go(r);
    s.palette.show(":");
  }
}

// ---------------------------------------------------------------- mount: router, keys, SSE, width, link interception
let body: HTMLDivElement | undefined = $state();

onMount(() => {
  const offs: (() => void)[] = [];
  offs.push(s.router.attach(window));
  offs.push(
    s.keys.attach(window, {
      scopes,
      when,
      singleKeys: () => s.prefs.singleKeys,
      imeHint,
      holdAlt: (on) => (s.ui.showCites = on),
      allow: (id) => s.layers.top()?.kind !== "dialog" || id === "layer.close",
      unmet,
    }),
  );
  const k = s.keys;
  offs.push(
    // a second ⌘K outside the palette input closes it through the layer stack (focus returns)
    k.on("palette.open", () => (s.palette.open ? s.layers.close("palette") : s.palette.show())),
    k.on("search.inDoc", () => s.palette.show("", "doc")),
    k.on("help.shortcuts", () => (s.ui.helpOpen = true)),
    k.on("nav.map", () => navTo("map")),
    k.on("nav.doc", () => navTo("doc")),
    k.on("nav.inbox", () => navTo("inbox")),
    k.on("nav.code", () => navTo("code")),
    k.on("nav.review", () => navTo("review")),
    k.on("nav.settings", () => navTo("settings")),
    k.on("pane.nav", () => {
      if (document.querySelector('.rail[data-mode="drawer"]')) s.ui.railOpen = !s.ui.railOpen;
      else s.prefs.setRailCollapsed(!s.prefs.railCollapsed);
    }),
    k.on("pane.toc", () => {
      const a = (document.querySelector('.toc a[aria-current="page"]') ?? document.querySelector(".toc a")) as HTMLElement | null;
      a?.focus();
    }),
    k.on("pane.threads", () => (s.map.overlays.comments = !s.map.overlays.comments)),
    k.on("layer.close", () => {
      if (!s.layers.closeTop() && s.ui.railOpen) s.ui.railOpen = false;
    }),
  );
  offs.push(
    wireSse(s, {
      resync: () => {
        void s.workspace.refresh();
        void s.doc.loadOutline();
        void s.review.load();
        void s.inbox.load();
        s.map.invalidate();
      },
      notice: (e) =>
        s.bottom.toast({
          id: `notice.${e.key}`,
          kind: e.level === "error" ? "error" : e.level === "warn" ? "warn" : "info",
          key: e.key.startsWith("notice.") ? e.key : `notice.${e.key}`,
        }),
      firstBlock: (e) => {
        const run = s.gen.run;
        if (run?.state === "running" && run.progress.blocks === 0 && !s.bottom.has("gen.firstBlock")) {
          const sec = e.block.section;
          const ws = s.workspace.key;
          s.bottom.toast({
            id: "gen.firstBlock",
            kind: "info",
            key: "toast.gen.firstBlock",
            params: {
              id: s.doc.index?.numbers.get(sec) ?? sec.replace(/^s/, ""),
              title: s.doc.index?.nodes.get(sec)?.title ?? "",
              s: run.startedAt ? ((Date.now() - Date.parse(run.startedAt)) / 1000).toFixed(1) : "–",
            },
            action: { key: "toast.action.read", kbd: "g d", run: () => ws && void s.router.go({ name: "doc", ws, section: sec }) },
          });
          mark("mitori:block:first");
        }
      },
      genDone: (e) => {
        const u = e.run.usage;
        const ws = s.workspace.key;
        s.bottom.toast({
          id: "gen.done",
          kind: "success",
          key: "toast.gen.done",
          params: {
            in: fmtTokensImpl(u.in + u.cacheRead + u.cacheWrite),
            c: fmtTokensImpl(u.cacheRead),
            out: fmtTokensImpl(u.out),
            usd: fmtUsdImpl(u.apiUsd, "gen"),
            dur: fmtDurationImpl(runMs(e.run), "job"),
            delta: fmtDeltaImpl(u.apiUsd, e.run.estimate.apiUsd),
          },
          action: {
            key: "toast.action.path5",
            run: () => {
              if (!ws) return;
              setItem("session", STORAGE_KEYS.path(ws), "5min");
              void s.router.go({ name: "doc", ws, section: "s0" });
            },
          },
        });
      },
    }),
  );
  // width from the grid container (never 100vw), ux.md R1 §3.1
  const ro = new ResizeObserver(() => {
    if (body) s.ui.width = body.clientWidth;
  });
  if (body) ro.observe(body);
  offs.push(() => ro.disconnect());
  s.bottom.set("statusbar", "statusbar", 24);
  // settings: server wins over the cookie (ux.md §3.2-6)
  void s.session.loadSettings({ reuse: true }).then((v) => applySettings(s, v));
  void s.session.loadDaemon();
  void s.session.loadUsage();
  void loadExtensions(s).then((e) => (ext = e));
  return () => {
    for (const off of offs) off();
  };
});

/** Wall time of a run (the gen chunk's `elapsedMs` without pulling it into the entry). */
function runMs(r: { startedAt?: string; finishedAt?: string }): number {
  if (!r.startedAt) return 0;
  return Math.max(0, (r.finishedAt ? Date.parse(r.finishedAt) : Date.now()) - Date.parse(r.startedAt));
}

// help chunk, loaded on the first `?`
let Help = $state.raw<Component<Record<string, never>> | null>(null);
$effect(() => {
  if (s.ui.helpOpen && !Help) void import("./HelpOverlay.svelte").then((m) => (Help = m.default));
});

// palette chunk, loaded on first ⌘K
let Palette = $state.raw<Component<Record<string, never>> | null>(null);
$effect(() => {
  if (s.palette.open && !Palette) void import("../palette/Palette.svelte").then((m) => (Palette = m.default));
});

const conn = $derived(s.session.connection);

// live regions (ux.md §11.2): the connection coming back (the loss itself is the retrying banner, role=alert)
let wasDown = false;
$effect(() => {
  const k = conn.kind;
  untrack(() => {
    if (k === "retrying" || k === "stopped" || k === "auth_expired") wasDown = true;
    else if (k === "live" && wasDown) {
      wasDown = false;
      s.ui.announce(t("a11y.reconnected"));
    }
  });
});

// billed per use from here on (window.overage / billing === "overage"): one notice per session (§3.4, addendum A1)
$effect(() => {
  const w = s.session.window;
  if (!(w?.billing === "overage" || w?.overage?.active)) return;
  untrack(() => {
    if (getItem("session", STORAGE_KEYS.hint("overage"))) return;
    setItem("session", STORAGE_KEYS.hint("overage"), "1");
    s.bottom.toast({ id: "overage", kind: "warn", key: "toast.overage" });
  });
});
const InboxView = $derived(ext?.views?.inbox ?? null);
</script>

<a class="skip" href="#main">{t("a11y.skip")}</a>
<!-- the page behind the ⌘K palette (aria-modal) is inert: Tab stays in the palette -->
<div class="app" data-view={kind} data-mode={mode} inert={conn.kind === "stopped" || (s.palette.open && !!Palette) || undefined}>
  <Header />
  <Banner />
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (delegated link interception) -->
  <div class="body-wrap" bind:this={body} onclick={(e) => s.router.intercept(e)}>
    {#if route.name === "inbox"}
      {#if InboxView}<InboxView />{:else}<main id="main" class="pending-view" tabindex="-1"><p>{t("app.inboxPending")}</p></main>{/if}
    {:else if View}
      <View />
    {:else}
      <div class="body skel-body" aria-busy="true"><aside class="rail"></aside><main id="main"></main></div>
    {/if}
  </div>
  <StatusBar />
  <Toasts />
</div>

{#if s.ui.helpOpen && Help}<Help />{/if}
{#if Palette && s.palette.open}<Palette />{/if}

{#if conn.kind === "stopped"}
  <div class="stopped" role="alertdialog" aria-modal="true" aria-labelledby="stopped-t" data-chrome>
    <div class="card">
      <h2 id="stopped-t">{t("app.stopped")}</h2>
      <p>{conn.reason}</p>
      <p><Rich text={t("app.stoppedHint")} /></p>
      <button type="button" class="btn btn-sec" onclick={() => copyText("mitori", s, "copy.command")}>{t("banner.copyCommand")}</button>
    </div>
  </div>
{/if}

<div class="sr-only" aria-live="polite" id="live-polite">{s.ui.polite}</div>
<div class="sr-only" aria-live="assertive" id="live-assertive">{s.ui.assertive}</div>
<p class="sr-only" id="sr-verdict-inferred">{t("verdict.desc.inferred")}</p>
<p class="sr-only" id="sr-verdict-unsupported">{t("verdict.desc.unsupported")}</p>
<p class="sr-only" id="sr-verdict-stale">{t("verdict.desc.stale")}</p>

<style>
  .pending-view {
    padding: 64px;
    color: var(--muted);
  }
</style>
