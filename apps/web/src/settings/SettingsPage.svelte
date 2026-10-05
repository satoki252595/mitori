<!--
  S9 設定 (ux.md §4.9) — the 一般 and ショートカット tabs (language, theme, reader level, single-key shortcuts) and
  the engine cards. Each item saves on change (PATCH /settings, debounced in PrefsState). The key-remap editor is
  a stretch item (☆).
-->
<script lang="ts">
import type { GenEngineId, ReaderLevel, ReasoningEffort } from "@mitori/core";
import { onMount } from "svelte";
import { copyText } from "../shell/clipboard.ts";
import { t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { setReaderLevel, useStores } from "../stores/app.svelte.ts";
import { genericProviderCommand, genericProviderPatch, MUSE_ARGS } from "./provider.ts";

const s = useStores();
onMount(() => {
  void s.session.loadEngines();
  void s.session.loadSettings({ reuse: true });
  markAfterPaint("mitori:section:rendered", { id: "settings" });
  s.router.painted();
});
const LEVELS: ReaderLevel[] = ["newcomer", "standard", "expert"];
let provider = $state<GenEngineId>("claude-cli");
let model = $state("");
let argv = $state("[]");
let reasoning = $state<ReasoningEffort>("high");
let protocol = $state<"text" | "muse-jsonl">("text");
let inputPrice = $state<number | undefined>();
let outputPrice = $state<number | undefined>();
let cachePrice = $state<number | undefined>();
let timeoutSeconds = $state<number | undefined>();
let initialized = $state(false);
let saving = $state(false);
let saved = $state(false);
let providerError = $state(false);
let setupCommand = $state("");
let savingFloorplan = $state(false);
async function setFloorplan(enabled: boolean) {
  if (savingFloorplan) return;
  savingFloorplan = true;
  try {
    if (await s.prefs.patchNow({ ui: { map: { floorplan: enabled } } })) {
      await s.session.loadSettings();
      await s.map.load(true);
    }
  } finally {
    savingFloorplan = false;
  }
}
$effect(() => {
  const cfg = s.session.settings?.settings;
  if (!cfg || initialized) return;
  provider = cfg.defaultGenEngine;
  model = cfg.models.genModule.startsWith("generic:") ? cfg.models.genModule : "";
  argv = JSON.stringify(cfg.engines.generic.argv);
  reasoning = cfg.reasoning.gen;
  protocol = cfg.engines.generic.protocol ?? "text";
  inputPrice = cfg.engines.generic.pricing?.inPerMTok;
  outputPrice = cfg.engines.generic.pricing?.outPerMTok;
  cachePrice = cfg.engines.generic.pricing?.cacheReadPerMTok;
  timeoutSeconds = cfg.engines.generic.turnMs === undefined ? undefined : cfg.engines.generic.turnMs / 1000;
  initialized = true;
});

function musePreset() {
  const configured = s.session.settings?.settings.engines.generic.argv[0];
  provider = "generic";
  model = "generic:muse-spark-1.3-contributor";
  argv = JSON.stringify([configured && /\/muse-bin(?:-[^/]+)?$/.test(configured) ? configured : "", ...MUSE_ARGS]);
  reasoning = "max";
  protocol = "muse-jsonl";
  inputPrice = 0.1;
  outputPrice = 0.2;
  cachePrice = 0.002;
  timeoutSeconds = 600;
  saved = false;
  setupCommand = "";
}

async function saveProvider(e: SubmitEvent) {
  e.preventDefault();
  if (saving || !initialized) return;
  saving = true;
  saved = false;
  providerError = false;
  try {
    const patch =
      provider === "generic"
        ? genericProviderPatch({
            model: model.trim(),
            argv,
            reasoning,
            protocol,
            pricing: { inPerMTok: inputPrice ?? NaN, outPerMTok: outputPrice ?? NaN, cacheReadPerMTok: cachePrice ?? NaN },
            ...(timeoutSeconds === undefined ? {} : { turnMs: timeoutSeconds * 1000 }),
          })
        : { defaultGenEngine: provider };
    if (provider === "generic") {
      const current = (await s.session.loadSettings())?.settings.engines.generic;
      const next = patch.engines?.generic;
      if (
        !current ||
        !next ||
        current.enabled !== next.enabled ||
        JSON.stringify(current.argv) !== JSON.stringify(next.argv) ||
        (current.protocol ?? "text") !== next.protocol ||
        current.turnMs !== next.turnMs ||
        current.pricing?.inPerMTok !== next.pricing?.inPerMTok ||
        current.pricing?.outPerMTok !== next.pricing?.outPerMTok ||
        current.pricing?.cacheReadPerMTok !== next.pricing?.cacheReadPerMTok
      ) {
        setupCommand = genericProviderCommand(patch);
        return;
      }
      delete patch.engines;
    }
    if (!(await s.prefs.patchNow(patch))) throw new Error("settings.providerInvalid");
    setupCommand = "";
    await Promise.all([s.session.loadSettings(), s.session.loadEngines()]);
    s.gen.estimates.clear();
    s.gen.sectionEstimates.clear();
    await s.gen.setEngine(provider);
    saved = true;
  } catch {
    providerError = true;
  } finally {
    saving = false;
  }
}
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
    <h2>{t("settings.map")}</h2>
    <label class="row check"><input type="checkbox" disabled={savingFloorplan} checked={s.session.settings?.settings.ui.map?.floorplan ?? false} onchange={(e) => void setFloorplan(e.currentTarget.checked)} /><span>{t("settings.floorplan")}</span></label>
    <p class="note">{t("settings.floorplanNote")}</p>
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
        <button type="button" class="btn btn-sec btn-s" onclick={(e) => { e.currentTarget.focus(); s.ui.exportOpen = true; }}>{t("settings.exportOpen")}</button>
      </div>
    </section>
  {/if}

  <section>
    <h2>{t("settings.engines")}</h2>
    <form onsubmit={saveProvider} oninput={() => (saved = false)}>
      <label class="row"><span>{t("settings.provider")}</span><select bind:value={provider} disabled={!initialized}>
        {#each ["claude-cli", "anthropic-api", "session", "generic"] as engine (engine)}<option value={engine}>{engine}</option>{/each}
      </select></label>
      <button type="button" class="btn btn-sec btn-s" disabled={!initialized} onclick={musePreset}>{t("settings.musePreset")}</button>
      {#if provider === "generic"}
        <label class="row"><span>{t("settings.model")}</span><input class="mono" required bind:value={model} placeholder="generic:model-id" /></label>
        <label class="row"><span>{t("settings.reasoning")}</span><select bind:value={reasoning}>{#each ["low", "medium", "high", "xhigh", "max"] as level (level)}<option value={level}>{level}</option>{/each}</select></label>
        <label class="row argv"><span>{t("settings.argv")}</span><textarea class="mono" required bind:value={argv} rows="5" spellcheck="false"></textarea></label>
        <p class="note">{t("settings.argvHint")}</p>
        <label class="row"><span>{t("settings.protocol")}</span><select bind:value={protocol}><option value="text">text</option><option value="muse-jsonl">Muse JSONL</option></select></label>
        <p class="note">{t("settings.pricingHint")}</p>
        <label class="row"><span>{t("settings.timeout")}</span><input type="number" min="1" max="3600" step="1" bind:value={timeoutSeconds} /></label>
        <label class="row"><span>{t("settings.priceInput")}</span><input type="number" min="0" step="any" required bind:value={inputPrice} /></label>
        <label class="row"><span>{t("settings.priceOutput")}</span><input type="number" min="0" step="any" required bind:value={outputPrice} /></label>
        <label class="row"><span>{t("settings.priceCache")}</span><input type="number" min="0" step="any" required bind:value={cachePrice} /></label>
        {#if model === "generic:muse-spark-1.3-contributor"}<p class="note">{t("settings.museContributor")} <a href="https://dev.meta.ai/docs/pricing-rate-limits" target="_blank" rel="noopener noreferrer">{t("settings.providerPolicy")}</a></p>{/if}
      {/if}
      <button type="submit" class="btn btn-pri btn-s" disabled={!initialized || saving}>{t(saving ? "settings.providerSaving" : "settings.providerSave")}</button>
      {#if setupCommand}
        <p class="note">{t("settings.providerSetup")}</p>
        <pre class="mono">{setupCommand}</pre>
        <button type="button" class="btn btn-sec btn-s" onclick={() => copyText(setupCommand, s, "copy.command")}>{t("settings.copySetup")}</button>
      {/if}
      {#if providerError}<p class="bad" role="alert">{t("settings.providerInvalid")}</p>{/if}
      {#if saved}<p class="note" role="status">{t("settings.providerSaved")}</p>{/if}
    </form>
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
  input:not([type="checkbox"]), textarea {
    padding: 6px 8px;
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    background: var(--paper);
    color: var(--ink);
    min-width: 0;
  }
  .argv { align-items: start; }
  textarea { width: 70%; resize: vertical; }
  form { margin-bottom: 20px; }
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
