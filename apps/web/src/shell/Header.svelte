<!--
  Header (52 px, ux.md §3.3, prototype `01-first-run-map`): brand │ workspace `{name} {HEAD7} · {tag}` │ tabs │
  crumbs │ ⌘K │ reader level │ job chip │ usage `今日 $ · tok` / `5h %` (≥ 1400 px only; the status bar keeps the
  full segment) │ theme │ lang │ ?. Badge slots keep their width at 0 (no layout shift).
-->
<script lang="ts">
import type { ReaderLevel } from "@mitori/core";
import { HREFS } from "@mitori/core";
import { flushSync, untrack } from "svelte";
import { currentLayout, setReaderLevel, useStores } from "../stores/app.svelte.ts";
import { fmtTokensImpl, fmtUsdImpl } from "./fmt.ts";
import { t } from "./index.ts";
import { replaceChrome } from "./native.ts";
import { getItem, getJson, STORAGE_KEYS, setJson } from "./storage.ts";

const s = useStores();
const route = $derived(s.router.route);
const ws = $derived("ws" in route ? route.ws : null);
const status = $derived(s.workspace.status);
const chip = $derived(s.review.chip);
let JobChip = $state.raw<typeof import("./JobChip.svelte").default | null>(null);
$effect(() => {
  if (chip.running + chip.locked > 0 && !JobChip) void import("./JobChip.svelte").then((m) => (JobChip = m.default));
});
const inboxN = $derived(s.inbox.mineCount);
const tag = $derived(status?.profile?.head?.tag ?? null);

// AC-U03: the chip's name and HEAD arrive after the first paint and the tabs are centred beside it, so a growing chip
// moved them. The chip as last shown for this workspace is drawn at once (stale until the status answers, same
// width when nothing changed); a workspace never opened in this browser reserves the usual width for the page's life
// — unless the tabs would not fit beside it: the reservation then goes before any text is shed (fit()).
type ProjChip = { name: string; head: string; tag: string | null };
const cachedChip = $derived(ws ? getJson<ProjChip>("local", STORAGE_KEYS.proj(ws)) : null);
// a snapshot at mount, on purpose: the reservation must not drop (and move the tabs) when the status arrives
const coldWs = untrack(() => (ws && !cachedChip ? ws : null));
let reserveOn = $state(true);
const reserve = $derived(reserveOn && ws !== null && ws === coldWs);
const projName = $derived(status?.info.name ?? cachedChip?.name ?? "");
const projHead = $derived(s.workspace.head7 || cachedChip?.head || "");
const projTag = $derived(status ? tag : (cachedChip?.tag ?? null));
$effect(() => {
  const name = status?.info.name;
  const head = s.workspace.head7;
  if (!ws || !name || !head) return;
  const next: ProjChip = { name, head, tag };
  const prev = untrack(() => cachedChip);
  if (prev?.name !== next.name || prev.head !== next.head || prev.tag !== next.tag) setJson("local", STORAGE_KEYS.proj(ws), next);
});
const today = $derived(s.session.today);
const fiveH = $derived((s.session.window ?? s.session.engine(status?.genEngine ?? null)?.window ?? null)?.fiveHour ?? null);
// the rail is a drawer (narrow container, review, code mode): the menu button opens it — except while reviewing on a
// wide screen, where the Review is the task (prototype 03e: no menu button; the drawer stays on `pane.nav`)
const drawer = $derived("ws" in route && currentLayout(s).railMode === "drawer");
let wsMenu = $state(false);

// NC-14: the tabs never run into the project chip or the right group (English labels are wider, project names long):
// when they do not fit, the header sheds the least useful text first — 1: the HEAD / tag and the usage block, 2: the
// brand's latin line and the search label. The level is decided in one go — the least shedding that fits, measured
// level by level with the DOM flushed in between — on a resize of the header or of the tabs (a ResizeObserver
// callback runs before paint) and when the language or the name changes. Shedding never changes the tabs' own
// width, so the answer is stable: giving text back one level at a time used to flap between 0 and 1 when hiding the
// usage block freed more than the hysteresis, every flip resizing the tabs and asking again.
let hdrEl: HTMLElement | undefined = $state();
let tight = $state(0);
function fit() {
  const mid = hdrEl?.querySelector<HTMLElement>(".hdr-m");
  const tabs = hdrEl?.querySelector<HTMLElement>(".tabs");
  if (!mid || !tabs) return;
  const over = () => mid.clientWidth < tabs.scrollWidth;
  let k = 0;
  if (tight !== 0) {
    tight = 0;
    flushSync();
  }
  // the chip's held width yields first, and for good (it never comes back to push the tabs again)
  if (reserve && over()) {
    reserveOn = false;
    flushSync();
  }
  while (k < 2 && over()) {
    k++;
    tight = k;
    flushSync();
  }
}
let tabsEl: HTMLElement | undefined = $state();
$effect(() => {
  const el = hdrEl;
  if (!el || typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(() => fit());
  ro.observe(el);
  // the tabs widen on their own too (the review / inbox counts arrive, the catalog of another language): a header
  // of the same width can stop fitting — the first tab was left clipped at 1440 px in English
  if (tabsEl) ro.observe(tabsEl);
  return () => ro.disconnect();
});
$effect(() => {
  void s.prefs.lang;
  void status?.info.name;
  void s.workspace.head7;
  requestAnimationFrame(fit);
});

const LEVELS: ReaderLevel[] = ["newcomer", "standard", "expert"];

function docHref(): string {
  if (!ws) return "/";
  const last = getItem("session", STORAGE_KEYS.lastPage(ws));
  return HREFS.doc(ws, (last as "s0" | null) ?? "s0");
}

const current = $derived.by(() => {
  switch (route.name) {
    case "map":
      return "map";
    case "doc":
    case "code":
      return route.name === "doc" && route.ctx === "review" ? "review" : "doc";
    case "inbox":
      return "inbox";
    case "review":
    case "reviewNext":
      return "review";
    default:
      return null;
  }
});

const themeNext = $derived(s.prefs.theme === "system" ? "light" : s.prefs.theme === "light" ? "dark" : "system");

function toggleWsMenu() {
  wsMenu = !wsMenu;
  if (wsMenu) {
    void s.session.loadWorkspaces();
    s.layers.open("popover", "ws-menu", () => (wsMenu = false));
  } else s.layers.drop("ws-menu");
}

const crumbs = $derived.by(() => {
  if (route.name !== "doc" || !s.doc.index) return [] as string[];
  const out: string[] = [];
  let id: string | undefined = route.section;
  while (id) {
    const n = s.doc.index.nodes.get(id as "s0");
    if (n) out.unshift(n.title);
    id = s.doc.index.parent.get(id as "s0");
  }
  return out;
});
const esc = (value: string | number) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (d: string) => `<svg class="i" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
let left: HTMLDivElement | undefined = $state();
let middle: HTMLDivElement | undefined = $state();
let before: HTMLDivElement | undefined = $state();
let after: HTMLDivElement | undefined = $state();
let menu: HTMLDivElement | undefined = $state();
function parts(): string[] {
  const e = esc;
  const btn = (act: string, label: string, d: string, cls = "icon-btn") =>
    `<button type="button" class="${cls}" data-act="${act}" aria-label="${e(label)}" title="${e(label)}">${icon(d)}</button>`;
  return [
    `<button type="button" class="icon-btn menu-btn${drawer ? " show" : ""}${current === "review" ? " in-review" : ""}" data-act="rail" aria-label="${e(t("header.menu"))}"${drawer ? ` aria-expanded="${s.ui.railOpen}"` : ""}>${icon("M2.5 4.5h11M2.5 8h11M2.5 11.5h11")}</button><a class="brand" href="/" aria-label="${e(t("header.home"))}"><span class="brand-ja" data-brand>${e(t("brand.name"))}</span><span class="brand-en">${e(t("brand.latin"))}</span></a>${ws ? `<span class="hdr-sep" aria-hidden="true"></span><button type="button" class="proj${reserve ? " reserve" : ""}" data-act="ws" aria-haspopup="true" aria-expanded="${wsMenu}"><span class="proj-name" data-user-content>${e(projName)}</span><span class="proj-meta">${e(projHead)}${projTag ? `<span class="tag"> &middot; <span data-user-content>${e(projTag)}</span></span>` : ""}</span>${status?.info.kind === "shadow" ? `<span class="kind-badge" title="${e(t("header.shadowTip"))}">${e(t("header.shadow"))}</span>` : status?.info.kind === "remote-readonly" ? `<span class="kind-badge">${e(t("header.readonly"))}</span>` : ""}</button>` : ""}`,
    ws
      ? `<nav class="tabs" aria-label="${e(t("nav.label"))}">${[
          ["map", HREFS.map(ws), ""],
          ["doc", docHref(), ""],
          [
            "inbox",
            `/w/${ws}/inbox`,
            `<span class="tab-count"${inboxN === 0 ? ' data-zero=""' : ""} aria-label="${e(t("a11y.count", { n: inboxN }))}">${inboxN}</span>`,
          ],
          [
            "review",
            `/w/${ws}/review`,
            `<span class="tab-count prop"${chip.ready === 0 ? ' data-zero=""' : ""} aria-label="${e(t("a11y.count", { n: chip.ready }))}">&#x25C6;${chip.ready}</span>`,
          ],
        ]
          .map(
            ([name, href, count]) =>
              `<a class="tab" href="${e(href ?? "#")}"${current === name ? ' aria-current="page"' : ""}><span>${e(t(`nav.${name}`))}</span>${count}</a>`,
          )
          .join("")}</nav>`
      : "",
    `<ol class="crumbs" aria-label="${e(t("header.crumbs"))}">${crumbs.length > 1 ? `<li>${e(t("nav.map"))}</li>${crumbs.map((c) => `<li data-user-content>${e(c)}</li>`).join("")}` : ""}</ol><button type="button" class="search" data-act="search" aria-label="${e(t("header.searchAria"))}">${icon("M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5")}<span>${e(t("header.search"))}</span><kbd>${e(s.keys.hint("palette.open"))}</kbd></button><div class="seg level" role="radiogroup" aria-label="${e(t("level.label"))}">${LEVELS.map((l) => `<label${s.doc.level === l ? ' class="on"' : ""}><input type="radio" name="mitori-level" value="${l}"${s.doc.level === l ? " checked" : ""}/><span>${e(t(`level.${l}`))}</span></label>`).join("")}</div>`,
    `<p class="usage mono">${today ? `<span class="u1">${e(t("header.usage.today", { usd: fmtUsdImpl(today.apiUsd, "day"), tok: fmtTokensImpl(today.in + today.cacheRead + today.cacheWrite + today.out) }))}</span>` : ""}${fiveH ? `<span class="u2">${e(t("header.usage.window", { p: Math.round(fiveH.utilization * 100) }))}</span>` : ""}</p>${btn("theme", t(`header.theme.${themeNext}`), "M8 1.5a6.5 6.5 0 1 0 0 13ZM8 1.5a6.5 6.5 0 0 1 0 13", "icon-btn theme-btn")}<button type="button" class="lang-btn" data-act="lang" lang="${s.prefs.lang === "ja" ? "en" : "ja"}" aria-label="${e(t("header.langSwitch"))}">${s.prefs.lang === "ja" ? "EN" : "JA"}</button>${btn("help", t("header.help"), "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1")}`,
    wsMenu
      ? `<div class="pop ws-menu" role="menu" aria-label="${e(t("header.wsMenu"))}">${s.session.workspaces
          .slice(0, 8)
          .map(
            (w) =>
              `<a role="menuitem" data-act="pick" href="${e(HREFS.map(w.info.key))}"><span data-user-content>${e(w.info.name)}</span><span class="mono">${e(w.info.root)}</span></a>`,
          )
          .join("")}<a role="menuitem" class="all" href="/" data-act="pick">${e(t("header.allWorkspaces"))}</a></div>`
      : "",
  ];
}
const initialHtml = untrack(() => parts());
const last = ["", "", "", "", ""];
$effect(() => {
  const html = parts();
  const hosts = [left, middle, before, after, menu];
  untrack(() => {
    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i],
        next = html[i];
      if (!host || next === undefined || last[i] === next) continue;
      const active = document.activeElement as HTMLElement | null;
      const inside = active && host.contains(active);
      const href = inside ? active.getAttribute("href") : null;
      const attr = inside
        ? active.dataset.act
          ? ["data-act", active.dataset.act]
          : href
            ? ["href", href]
            : active instanceof HTMLInputElement
              ? ["value", active.value]
              : null
        : null;
      replaceChrome(host, next);
      last[i] = next;
      if (attr) host.querySelector<HTMLElement>(`[${attr[0]}="${CSS.escape(attr[1] ?? "")}"]`)?.focus({ preventScroll: true });
    }
    tabsEl = middle?.querySelector<HTMLElement>(".tabs") ?? undefined;
    requestAnimationFrame(fit);
  });
});
function click(e: MouseEvent) {
  const target = (e.target as Element).closest<HTMLElement>("[data-act]");
  switch (target?.dataset.act) {
    case "rail":
      s.ui.railOpen = !s.ui.railOpen;
      break;
    case "ws":
      toggleWsMenu();
      break;
    case "pick":
      s.layers.close("ws-menu", { restoreFocus: false });
      break;
    case "search":
      s.palette.show();
      break;
    case "theme":
      s.prefs.setTheme(themeNext);
      break;
    case "lang":
      s.prefs.setLang(s.prefs.lang === "ja" ? "en" : "ja");
      break;
    case "help":
      s.ui.helpOpen = true;
      break;
  }
}
function change(e: Event) {
  const target = e.target;
  if (target instanceof HTMLInputElement && target.name === "mitori-level") setReaderLevel(s, target.value as ReaderLevel);
}
</script>
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (delegated native controls) -->
<header class="hdr" data-chrome bind:this={hdrEl} data-tight={tight || undefined} onclick={click} onchange={change}>
<div class="hdr-l" bind:this={left}>{@html initialHtml[0] ?? ""}</div>
<div class="hdr-m" bind:this={middle}>{@html initialHtml[1] ?? ""}</div>
<div class="hdr-r"><div class="native" bind:this={before}>{@html initialHtml[2] ?? ""}</div>{#if JobChip}<JobChip running={chip.running} locked={chip.locked} ready={0}/>{/if}<div class="native" bind:this={after}>{@html initialHtml[3] ?? ""}</div></div>
<div class="native" bind:this={menu}>{@html initialHtml[4] ?? ""}</div>
</header>
<style>
.native {display:contents;}
:global(.hdr .menu-btn.show) {
    display: grid;
  }@media (min-width: 1024px) {:global(.hdr .menu-btn.show.in-review) {
      display: none;
    }
  }:global(.hdr .hdr-m) {
    display: flex;
    align-items: stretch;
    gap: 14px;
    min-width: 0;
    height: 100%;
  }:global(.hdr .crumbs) {

    flex: 1 1 0;
    width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-label);
    color: var(--muted);
    overflow: hidden;
    white-space: nowrap;
  }:global(.hdr .crumbs li) {
    overflow: hidden;
    text-overflow: ellipsis;
  }:global(.hdr .crumbs li + li::before) {
    content: "\203A";
    margin-right: 6px;
    color: var(--rule-2);
  }:global(.hdr .ws-menu) {
    top: calc(var(--hdr) - 6px);
    left: 150px;
    width: 360px;
    padding: 6px;
    display: flex;
    flex-direction: column;
  }:global(.hdr .ws-menu a) {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    border-radius: var(--r-btn);
    font-size: var(--fs-ui);
    color: var(--ink);
  }:global(.hdr .ws-menu a:hover),
:global(.hdr .ws-menu a:focus-visible) {
    background: var(--hover);
  }:global(.hdr .ws-menu .mono) {
    font-size: var(--fs-meta);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }:global(.hdr .ws-menu .all) {
    border-top: 1px solid var(--rule-soft);
    margin-top: 4px;
    color: var(--muted);
  }:global(.hdr .usage) {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;

    min-width: 11.5em;
    margin: 0 2px 0 4px;
    line-height: 1.25;
    white-space: nowrap;
  }:global(:root[lang="en"] .hdr .usage) {
    min-width: 10.5em;
  }:global(.hdr .u1) {
    font-size: var(--fs-label);
    color: var(--text);
  }:global(.hdr .u2) {
    font-size: var(--fs-meta);
    color: var(--muted);
  }:global(.hdr .tag) {
    color: var(--muted);
  }@media (max-width: 1399px) {:global(.hdr .usage) {
      display: none;
    }
  }@media (max-width: 1280px) {:global(.hdr .crumbs) {
      display: none;
    }
  }

</style>
