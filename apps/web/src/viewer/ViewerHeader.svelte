<!--
  Export header (ux.md §4.13): brand, title, the two tabs (見取り図 / 設計書), search, reader level, theme, language, help.
  The classes are the app header's (shell/styles/base.css); there is no workspace menu, usage, job chip or Inbox.
-->
<script lang="ts">
import type { ReaderLevel } from "@mitori/core";
import Icon from "../shell/Icon.svelte";
import { t } from "../shell/index.ts";
import { formatHash } from "./route.ts";
import { useViewer } from "./state.svelte.ts";

const v = useViewer();
const LEVELS: ReaderLevel[] = ["newcomer", "standard", "expert"];
const themeNext = $derived(v.theme === "system" ? "light" : v.theme === "light" ? "dark" : "system");
const head = $derived(v.payload.meta.head?.slice(0, 7) ?? "");
const title = $derived(v.payload.outline.manifest.title);
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
</script>

<header class="hdr" data-chrome>
  <div class="hdr-l">
    <button type="button" class="icon-btn menu-btn show" aria-label={t("header.menu")} aria-expanded={v.railOpen} onclick={() => (v.railOpen = !v.railOpen)}><Icon name="menu" /></button>
    <a class="brand" href="#/" aria-label={t("brand.name")} onclick={(e) => { e.preventDefault(); v.go(v.home()); }}>
      <span class="brand-ja" data-brand>{t("brand.name")}</span><span class="brand-en">{t("brand.latin")}</span>
    </a>
    <span class="hdr-sep" aria-hidden="true"></span>
    <span class="proj proj-static">
      <span class="proj-name" data-user-content>{title}</span>
      {#if head}<span class="proj-meta">{head}</span>{/if}
    </span>
  </div>

  <div class="hdr-m">
    <nav class="tabs" aria-label={t("nav.label")}>
      <a class="tab" href="#/map" aria-current={v.route.name === "map" ? "page" : undefined}><span>{t("nav.map")}</span></a>
      <a class="tab" href={formatHash({ name: "doc", section: v.route.name === "doc" ? v.route.section : (v.index.pages[0] ?? "s0"), block: null })} aria-current={v.route.name === "doc" ? "page" : undefined}><span>{t("nav.doc")}</span></a>
    </nav>
  </div>

  <div class="hdr-r">
    <button type="button" class="search" aria-label={t("header.searchAria")} onclick={() => (v.paletteOpen = true)}>
      <Icon name="search" /><span>{t("export.search.placeholder")}</span><kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
    <div class="seg level" role="radiogroup" aria-label={t("level.label")}>
      {#each LEVELS as l (l)}
        <label class:on={v.level === l}
          ><input type="radio" name="mitori-level" value={l} checked={v.level === l} onchange={() => v.setLevel(l)} /><span>{t(`level.${l}`)}</span></label
        >
      {/each}
    </div>
    <button type="button" class="icon-btn theme-btn" aria-label={t(`header.theme.${themeNext}`)} title={t(`header.theme.${themeNext}`)} onclick={() => v.setTheme(themeNext)}><Icon name="theme" /></button>
    <button type="button" class="lang-btn" lang={v.lang === "ja" ? "en" : "ja"} aria-label={t("header.langSwitch")} onclick={() => v.setLang(v.lang === "ja" ? "en" : "ja")}>{v.lang === "ja" ? "EN" : "JA"}</button>
    <button type="button" class="icon-btn" aria-label={t("header.help")} title={t("header.help")} onclick={() => (v.helpOpen = true)}><Icon name="help" /></button>
  </div>
</header>

<style>
  .proj-static {
    cursor: default;
  }
  .proj-static:hover {
    background: transparent;
  }
  .menu-btn.show {
    display: none;
  }
  @media (max-width: 1099px) {
    .menu-btn.show {
      display: grid;
    }
  }
  @media (max-width: 1280px) {
    .search span {
      display: none;
    }
  }
</style>
