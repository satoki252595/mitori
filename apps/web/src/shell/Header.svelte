<!--
  Header (52 px, ux.md §3.3): brand │ workspace │ tabs │ crumbs │ ⌘K │ reader level │ job chip │ theme │ lang │ ?
  Usage is NOT shown here (status bar). Badge slots keep their width at 0 (no layout shift).
-->
<script lang="ts">
import type { ReaderLevel } from "@mitori/core";
import { HREFS } from "@mitori/core";
import { currentLayout, setReaderLevel, useStores } from "../stores/app.svelte.ts";
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
// the rail is a drawer (narrow container, review, code mode): the menu button opens it
const drawer = $derived("ws" in route && currentLayout(s).railMode === "drawer");
let wsMenu = $state(false);

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

<header class="hdr" data-chrome>
  <div class="hdr-l">
    <button type="button" class="icon-btn menu-btn" class:show={drawer} aria-label={t("header.menu")} aria-expanded={drawer ? s.ui.railOpen : undefined} onclick={() => (s.ui.railOpen = !s.ui.railOpen)}><Icon name="menu" /></button>
    <a class="brand" href="/" aria-label={t("header.home")}>
      <span class="brand-ja" data-brand>{t("brand.name")}</span><span class="brand-en">{t("brand.latin")}</span>
    </a>
    {#if ws}
      <span class="hdr-sep" aria-hidden="true"></span>
      <button type="button" class="proj" aria-haspopup="true" aria-expanded={wsMenu} onclick={toggleWsMenu}>
        <span class="proj-name" data-user-content>{status?.info.name ?? ""}</span>
        <span class="proj-meta">{s.workspace.head7}</span>
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
    <JobChip running={chip.running} locked={chip.locked} ready={chip.ready} />
    <button type="button" class="icon-btn" aria-label={t(`header.theme.${themeNext}`)} title={t(`header.theme.${themeNext}`)} onclick={() => s.prefs.setTheme(themeNext)}><Icon name="theme" /></button>
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
  @media (max-width: 1280px) {
    .crumbs {
      display: none;
    }
  }
</style>
