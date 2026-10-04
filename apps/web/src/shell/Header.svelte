<!--
  Header (52 px, ux.md §3.3, prototype `01-first-run-map`): brand │ workspace `{name} {HEAD7} · {tag}` │ tabs │
  crumbs │ ⌘K │ reader level │ job chip │ usage `今日 $ · tok` / `5h %` (≥ 1400 px only; the status bar keeps the
  full segment) │ theme │ lang │ ?. Badge slots keep their width at 0 (no layout shift).
-->
<script lang="ts">
import type { ReaderLevel } from "@mitori/core";
import { HREFS } from "@mitori/core";
import { currentLayout, setReaderLevel, useStores } from "../stores/app.svelte.ts";
import { fmtTokensImpl, fmtUsdImpl } from "./fmt.ts";
import Icon from "./Icon.svelte";
import { t } from "./index.ts";
import JobChip from "./JobChip.svelte";
import { getItem, STORAGE_KEYS } from "./storage.ts";

const s = useStores();
const route = $derived(s.router.route);
const ws = $derived("ws" in route ? route.ws : null);
const status = $derived(s.workspace.status);
const chip = $derived(s.review.chip);
const inboxN = $derived(s.inbox.mineCount);
const tag = $derived(status?.profile?.head?.tag ?? null);
const today = $derived(s.session.today);
const fiveH = $derived((s.session.window ?? s.session.engine(status?.genEngine ?? null)?.window ?? null)?.fiveHour ?? null);
// the rail is a drawer (narrow container, review, code mode): the menu button opens it — except while reviewing on a
// wide screen, where the Review is the task (prototype 03e: no menu button; the drawer stays on `pane.nav`)
const drawer = $derived("ws" in route && currentLayout(s).railMode === "drawer");
let wsMenu = $state(false);

// NC-14: the tabs never run into the project chip or the right group (English labels are wider, project names long):
// when they do not fit, the header sheds the least useful text first — 1: the HEAD / tag and the usage block, 2: the
// brand's latin line and the search label. Measured on resize and when the language or the name changes (a
// ResizeObserver callback runs before paint: no visible shift); 120 px of slack before giving text back (no flapping).
let hdrEl: HTMLElement | undefined = $state();
let tight = $state(0);
function fit() {
  const mid = hdrEl?.querySelector<HTMLElement>(".hdr-m");
  const tabs = hdrEl?.querySelector<HTMLElement>(".tabs");
  if (!mid || !tabs) return;
  const slack = mid.clientWidth - tabs.scrollWidth;
  if (slack < 0 && tight < 2) {
    tight++;
    requestAnimationFrame(fit);
  } else if (slack > 120 && tight > 0) {
    tight--;
    requestAnimationFrame(() => {
      // giving text back made it overflow again: take it back
      const m = hdrEl?.querySelector<HTMLElement>(".hdr-m");
      const tb = hdrEl?.querySelector<HTMLElement>(".tabs");
      if (m && tb && m.clientWidth < tb.scrollWidth) tight++;
    });
  }
}
$effect(() => {
  const el = hdrEl;
  if (!el || typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(() => fit());
  ro.observe(el);
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
      <button type="button" class="proj" aria-haspopup="true" aria-expanded={wsMenu} onclick={toggleWsMenu}>
        <span class="proj-name" data-user-content>{status?.info.name ?? ""}</span>
        <span class="proj-meta">{s.workspace.head7}{#if tag}<span class="tag"> &middot; <span data-user-content>{tag}</span></span>{/if}</span>
        {#if status?.info.kind === "shadow"}<span class="kind-badge" title={t("header.shadowTip")}>{t("header.shadow")}</span>{/if}
        {#if status?.info.kind === "remote-readonly"}<span class="kind-badge">{t("header.readonly")}</span>{/if}
      </button>
    {/if}
  </div>

  <div class="hdr-m">
    {#if ws}
      <nav class="tabs" aria-label={t("nav.label")}>
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
    /* a fixed box, not a minimum (AC-U03): today's numbers arriving (or growing a digit) never move the tabs;
       a longer line ellipsizes — the status bar always carries the same numbers in full */
    width: 12em;
    overflow: hidden;
    margin: 0 2px 0 4px;
    line-height: 1.25;
    white-space: nowrap;
  }
  .u1,
  .u2 {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
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
