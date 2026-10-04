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
import Icon from "./Icon.svelte";
import { t } from "./index.ts";
import JobChip from "./JobChip.svelte";
import { getItem, getJson, STORAGE_KEYS, setJson } from "./storage.ts";

const s = useStores();
const route = $derived(s.router.route);
const ws = $derived("ws" in route ? route.ws : null);
const status = $derived(s.workspace.status);
const chip = $derived(s.review.chip);
const inboxN = $derived(s.inbox.mineCount);
const tag = $derived(status?.profile?.head?.tag ?? null);

// AC-U03: the chip's name and HEAD arrive after the first paint and the tabs are centred beside it, so a growing chip
// moved them. The chip as last shown for this workspace is drawn at once (stale until the status answers, same
// width when nothing changed); a workspace never opened in this browser reserves the usual width for the page's life.
type ProjChip = { name: string; head: string; tag: string | null };
const cachedChip = $derived(ws ? getJson<ProjChip>("local", STORAGE_KEYS.proj(ws)) : null);
// a snapshot at mount, on purpose: the reservation must not drop (and move the tabs) when the status arrives
const coldWs = untrack(() => (ws && !cachedChip ? ws : null));
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
</script>

<header class="hdr" data-chrome bind:this={hdrEl} data-tight={tight || undefined}>
  <div class="hdr-l">
    <button type="button" class="icon-btn menu-btn" class:show={drawer} class:in-review={current === "review"} aria-label={t("header.menu")} aria-expanded={drawer ? s.ui.railOpen : undefined} onclick={() => (s.ui.railOpen = !s.ui.railOpen)}><Icon name="menu" /></button>
    <a class="brand" href="/" aria-label={t("header.home")}>
      <span class="brand-ja" data-brand>{t("brand.name")}</span><span class="brand-en">{t("brand.latin")}</span>
    </a>
    {#if ws}
      <span class="hdr-sep" aria-hidden="true"></span>
      <button type="button" class="proj" class:reserve={ws === coldWs} aria-haspopup="true" aria-expanded={wsMenu} onclick={toggleWsMenu}>
        <span class="proj-name" data-user-content>{projName}</span>
        <span class="proj-meta">{projHead}{#if projTag}<span class="tag"> &middot; <span data-user-content>{projTag}</span></span>{/if}</span>
        {#if status?.info.kind === "shadow"}<span class="kind-badge" title={t("header.shadowTip")}>{t("header.shadow")}</span>{/if}
        {#if status?.info.kind === "remote-readonly"}<span class="kind-badge">{t("header.readonly")}</span>{/if}
      </button>
    {/if}
  </div>

  <div class="hdr-m">
    {#if ws}
      <nav class="tabs" aria-label={t("nav.label")} bind:this={tabsEl}>
        <a class="tab" href={HREFS.map(ws)} aria-current={current === "map" ? "page" : undefined}><span>{t("nav.map")}</span></a>
        <a class="tab" href={docHref()} aria-current={current === "doc" ? "page" : undefined}><span>{t("nav.doc")}</span></a>
        <a class="tab" href={`/w/${ws}/inbox`} aria-current={current === "inbox" ? "page" : undefined}
          ><span>{t("nav.inbox")}</span><span class="tab-count" data-zero={inboxN === 0 ? "" : undefined} aria-label={t("a11y.count", { n: inboxN })}>{inboxN}</span></a
        >
        <a class="tab" href={`/w/${ws}/review`} aria-current={current === "review" ? "page" : undefined}
          ><span>{t("nav.review")}</span><span class="tab-count prop" data-zero={chip.ready === 0 ? "" : undefined} aria-label={t("a11y.count", { n: chip.ready })}>&#x25C6;{chip.ready}</span></a
        >
      </nav>
    {/if}
  </div>

  <div class="hdr-r">
    <ol class="crumbs" aria-label={t("header.crumbs")}>
      {#if crumbs.length > 1}
        <li>{t("nav.map")}</li>
        {#each crumbs as c, i (i)}<li data-user-content>{c}</li>{/each}
      {/if}
    </ol>
    <button type="button" class="search" aria-label={t("header.searchAria")} onclick={() => s.palette.show()}>
      <Icon name="search" /><span>{t("header.search")}</span><kbd>{s.keys.hint("palette.open")}</kbd>
    </button>
    <div class="seg level" role="radiogroup" aria-label={t("level.label")}>
      {#each LEVELS as l (l)}
        <label class:on={s.doc.level === l}
          ><input type="radio" name="mitori-level" value={l} checked={s.doc.level === l} onchange={() => setReaderLevel(s, l)} /><span>{t(`level.${l}`)}</span></label
        >
      {/each}
    </div>
    <!-- ready jobs are the レビュー tab's count; the chip says what is still working (no ◆ twice in one header) -->
    <JobChip running={chip.running} locked={chip.locked} ready={0} />
    <!-- reserved box: the usage arriving never moves the tabs -->
    <p class="usage mono">
      {#if today}<span class="u1">{t("header.usage.today", { usd: fmtUsdImpl(today.apiUsd, "day"), tok: fmtTokensImpl(today.in + today.cacheRead + today.cacheWrite + today.out) })}</span>{/if}
      {#if fiveH}<span class="u2">{t("header.usage.window", { p: Math.round(fiveH.utilization * 100) })}</span>{/if}
    </p>
    <button type="button" class="icon-btn theme-btn" aria-label={t(`header.theme.${themeNext}`)} title={t(`header.theme.${themeNext}`)} onclick={() => s.prefs.setTheme(themeNext)}><Icon name="theme" /></button>
    <button type="button" class="lang-btn" lang={s.prefs.lang === "ja" ? "en" : "ja"} aria-label={t("header.langSwitch")} onclick={() => s.prefs.setLang(s.prefs.lang === "ja" ? "en" : "ja")}>{s.prefs.lang === "ja" ? "EN" : "JA"}</button>
    <button type="button" class="icon-btn" aria-label={t("header.help")} title={t("header.help")} onclick={() => (s.ui.helpOpen = true)}><Icon name="help" /></button>
  </div>

  {#if wsMenu}
    <div class="pop ws-menu" role="menu" aria-label={t("header.wsMenu")}>
      {#each s.session.workspaces.slice(0, 8) as w (w.info.key)}
        <a role="menuitem" href={HREFS.map(w.info.key)} onclick={() => s.layers.close("ws-menu", { restoreFocus: false })}>
          <span data-user-content>{w.info.name}</span><span class="mono">{w.info.root}</span>
        </a>
      {/each}
      <a role="menuitem" class="all" href="/" onclick={() => s.layers.close("ws-menu", { restoreFocus: false })}>{t("header.allWorkspaces")}</a>
    </div>
  {/if}
</header>

<style>
  .menu-btn.show {
    display: grid;
  }
  @media (min-width: 1024px) {
    .menu-btn.show.in-review {
      display: none;
    }
  }
  .hdr-m {
    display: flex;
    align-items: stretch;
    gap: 14px;
    min-width: 0;
    height: 100%;
  }
  .crumbs {
    /* takes only free space: never widens the column (no shift when crumbs arrive) */
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
  }
  .crumbs li {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumbs li + li::before {
    content: "\203A";
    margin-right: 6px;
    color: var(--rule-2);
  }
  .ws-menu {
    top: calc(var(--hdr) - 6px);
    left: 150px;
    width: 360px;
    padding: 6px;
    display: flex;
    flex-direction: column;
  }
  .ws-menu a {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    border-radius: var(--r-btn);
    font-size: var(--fs-ui);
    color: var(--ink);
  }
  .ws-menu a:hover,
  .ws-menu a:focus-visible {
    background: var(--hover);
  }
  .ws-menu .mono {
    font-size: var(--fs-meta);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ws-menu .all {
    border-top: 1px solid var(--rule-soft);
    margin-top: 4px;
    color: var(--muted);
  }
  .usage {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    /* the slot of a usual day's line (「今日$0.00 · 0 tok」 / 「Today $0.00 · 0 tok」): today's numbers arriving after
       the first paint do not move the tabs (AC-U03); a bigger day widens it once */
    min-width: 11.5em;
    margin: 0 2px 0 4px;
    line-height: 1.25;
    white-space: nowrap;
  }
  .u1 {
    font-size: var(--fs-label);
    color: var(--text);
  }
  .u2 {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .tag {
    color: var(--muted);
  }
  /* the usage block needs the full 1440 header; the status bar always has the same numbers */
  @media (max-width: 1399px) {
    .usage {
      display: none;
    }
  }
  @media (max-width: 1280px) {
    .crumbs {
      display: none;
    }
  }
</style>
