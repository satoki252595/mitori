<!--
  S9 設定 (ux.md §4.9) — the 一般 and ショートカット tabs (language, theme, reader level, single-key shortcuts) and
  the engine cards. Each item saves on change (PATCH /settings, debounced in PrefsState). The key-remap editor is
  a stretch item (☆).
-->
<script lang="ts">
import type { ReaderLevel } from "@mitori/core";
import { onMount } from "svelte";
import { t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { setReaderLevel, useStores } from "../stores/app.svelte.ts";

const s = useStores();
onMount(() => {
  void s.session.loadEngines();
  markAfterPaint("mitori:section:rendered", { id: "settings" });
  s.router.painted();
});
const LEVELS: ReaderLevel[] = ["newcomer", "standard", "expert"];
</script>

<main id="main" class="settings" tabindex="-1" data-chrome>
  <h1>{t("settings.title")}</h1>

  <section>
    <h2>{t("settings.general")}</h2>
    <label class="row"
      ><span>{t("settings.lang")}</span>
      <select value={s.prefs.lang} onchange={(e) => s.prefs.setLang(e.currentTarget.value === "en" ? "en" : "ja")}>
        <option value="ja">{t("settings.langJa")}</option>
        <option value="en">{t("settings.langEn")}</option>
      </select></label
    >
    <label class="row"
      ><span>{t("settings.theme")}</span>
      <select value={s.prefs.theme} onchange={(e) => s.prefs.setTheme(e.currentTarget.value as "system" | "light" | "dark")}>
        <option value="system">{t("settings.themeSystem")}</option>
        <option value="light">{t("settings.themeLight")}</option>
        <option value="dark">{t("settings.themeDark")}</option>
      </select></label
    >
    <label class="row"
      ><span>{t("settings.editor")}</span>
      <select value={s.prefs.editor} onchange={(e) => s.prefs.setEditor(e.currentTarget.value === "vscode" ? "vscode" : e.currentTarget.value === "cursor" ? "cursor" : "none")}>
        <option value="none">{t("settings.editorNone")}</option>
        <option value="vscode">VS Code</option>
        <option value="cursor">Cursor</option>
      </select></label
    >
    <label class="row"
      ><span>{t("settings.level")}</span>
      <select value={s.doc.level} onchange={(e) => setReaderLevel(s, e.currentTarget.value as ReaderLevel)}>
        {#each LEVELS as l (l)}<option value={l}>{t(`level.${l}`)}</option>{/each}
      </select></label
    >
  </section>

  <section>
    <h2>{t("settings.shortcuts")}</h2>
    <label class="row check"><input type="checkbox" checked={s.prefs.singleKeys} onchange={(e) => s.prefs.setSingleKeys(e.currentTarget.checked)} /><span>{t("settings.singleKeys")}</span></label>
    <p class="note">{t("settings.singleKeysNote")}</p>
  </section>

  {#if s.workspace.key}
    <section>
      <h2>{t("settings.export")}</h2>
      <div class="row">
        <span>{t("settings.exportLead")}</span>
        <button type="button" class="btn btn-sec btn-s" onclick={() => (s.ui.exportOpen = true)}>{t("settings.exportOpen")}</button>
      </div>
    </section>
  {/if}

  <section>
    <h2>{t("settings.engines")}</h2>
    {#each s.session.engines ?? [] as e (e.engine)}
      <div class="eng card">
        <b class="mono">{e.engine}</b>
        <span>{e.installed ? t("settings.installed", { version: e.version ?? "" }) : t("settings.notInstalled")}</span>
        <span>{t(`statusbar.auth.${e.auth}`)}</span>
        {#each e.problems as p (p.code)}<span class="bad">{t(`error.${p.code}`)}</span>{/each}
      </div>
    {:else}
      <p class="note">{t("app.loading")}</p>
    {/each}
  </section>
</main>

<style>
  .settings {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 24px 120px;
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--fs-h1);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 24px;
  }
  h2 {
    font-size: var(--fs-h3);
    color: var(--ink);
    margin: 28px 0 10px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule-soft);
    font-size: var(--fs-ui-l);
  }
  .row.check {
    justify-content: flex-start;
  }
  select {
    height: 32px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-input);
    background: var(--sheet);
    padding: 0 8px;
  }
  .note {
    color: var(--muted);
    font-size: var(--fs-ui);
  }
  .eng {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 12px 14px;
    margin: 0 0 8px;
    font-size: var(--fs-ui);
  }
  .bad {
    color: var(--c-bad);
  }
</style>
