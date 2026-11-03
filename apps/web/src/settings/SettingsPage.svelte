<!--
  S9 設定 (ux.md §4.9) — the 一般 and ショートカット tabs (language, theme, reader level, single-key shortcuts) and
  the engine cards. Each item saves on change (PATCH /settings, debounced in PrefsState). The key-remap editor is
  a stretch item (☆).
-->
<script lang="ts">
import {
  type DeepPartial,
  type EngineId,
  type GenEngineId,
  type GlobalSettings,
  type ModelId,
  PROVIDER_AUTH_IDS,
  type ProviderAuthId,
  type ReaderLevel,
  type ReasoningEffort,
} from "@mitori/core";
import { onMount } from "svelte";
import {
  claudeBinaryChanged,
  codexBinaryChanged,
  codexVerifiedVersion,
  museUpdated,
  type SetupContext,
  setupCommandFor,
  setupContextFor,
} from "../map/engine.ts";
import { copyText } from "../shell/clipboard.ts";
import { authDisplayKind } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { setReaderLevel, useStores } from "../stores/app.svelte.ts";
import {
  ADVANCED_ENGINES,
  EFFORTS,
  genericProviderCommand,
  genericProviderPatch,
  MUSE_ARGS,
  providerAuthCommand,
  providerSetupCommand,
  SETUP_PROVIDERS,
  type SetupModelOption,
  type SetupProvider,
  setupDefaultEffort,
  setupDefaultModel,
  setupModelOptions,
  setupModelPriceKnown,
  switchableModels,
  switchErrorKey,
  switchSetupHint,
} from "./provider.ts";

const s = useStores();
let enginesSection = $state<HTMLElement>();
onMount(() => {
  void s.session.loadEngines();
  void s.session.loadSettings({ reuse: true });
  if (s.ui.focusEngines) {
    s.ui.focusEngines = false;
    enginesSection?.scrollIntoView({ block: "start" });
  }
  markAfterPaint("mitori:section:rendered", { id: "settings" });
  s.router.painted();
});
const LEVELS: ReaderLevel[] = ["newcomer", "standard", "expert"];
let provider = $state<GenEngineId>("claude-cli");
let model = $state("");
let argv = $state("[]");
let reasoning = $state<ReasoningEffort>("high");
let protocol = $state<"text" | "muse-jsonl" | "openai-chat">("text");
let baseUrl = $state("");
let keyEnv = $state("");
let inputPrice = $state<number | undefined>();
let outputPrice = $state<number | undefined>();
let cachePrice = $state<number | undefined>();
let timeoutSeconds = $state<number | undefined>();
let initialized = $state(false);
let saving = $state(false);
let saved = $state(false);
let providerError = $state(false);
let setupCommand = $state("");
let simpleProvider = $state<SetupProvider>("claude");
let simpleModel = $state("");
let customModel = $state(false);
let customText = $state("");
let simpleBaseUrl = $state("");
let simpleKeyEnv = $state("");
let simpleInputPrice = $state<number | undefined>();
let simpleOutputPrice = $state<number | undefined>();
let simpleEffort = $state<ReasoningEffort>("high");
let setupRepo = $state("");
let guidedCommand = $state("");
let guidedError = $state(false);
let reloading = $state(false);
let useApi = $state(false);
let useGrokCli = $state(false);
let useAntigravityCli = $state(false);
let useCodexNative = $state(true);
let codexMaxUsd = $state<number | undefined>(1);
let signingIn = $state(false);
let loginResult = $state<"opened" | "fallback" | "">("");
let genSwitchModel = $state("");
let genSwitchEffort = $state<ReasoningEffort>("high");
let answerSwitchModel = $state("");
let answerSwitchEffort = $state<ReasoningEffort>("high");
let switchSaving = $state<"gen" | "answer" | null>(null);
let switchSaved = $state<"gen" | "answer" | null>(null);
/** Server refusal of a model switch: localized reason key plus the re-setup command (null when no setup helps). */
let switchError = $state<{ kind: "gen" | "answer"; key: string; command: string | null } | null>(null);
const setupExternal = $derived(
  ["cursor"].includes(simpleProvider) ||
    (simpleProvider === "codex" && !useCodexNative) ||
    (simpleProvider === "grok" && !useApi && !useGrokCli) ||
    (simpleProvider === "antigravity" && !useAntigravityCli),
);
const setupEffort = $derived(
  simpleProvider === "claude" ||
    simpleProvider === "muse" ||
    (simpleProvider === "codex" && useCodexNative) ||
    (simpleProvider === "grok" && useGrokCli) ||
    (simpleProvider === "antigravity" && useAntigravityCli),
);
/** CLI engine behind the quick-setup provider (Grok Build CLI or Antigravity CLI instead of the session). */
const guidedCli = $derived(simpleProvider === "grok" ? useGrokCli : simpleProvider === "antigravity" ? useAntigravityCli : false);
/** Catalog models of the quick-setup provider (empty for free-form providers and external sessions). */
const modelOptions = $derived(setupModelOptions(simpleProvider, { api: useApi, cli: guidedCli }));
/** Model id typed for a custom entry (a slug for codex/grok/antigravity/muse, a bare id for claude). */
const effectiveModel = $derived((customModel ? customText : simpleModel).trim());
/** Slug without the `codex:` / `grok:` / `antigravity:` / `generic:` prefix. */
const modelSlug = $derived(effectiveModel.split(":").at(-1) ?? "");
const selectedOption = $derived(customModel ? undefined : modelOptions.find((o) => o.id === simpleModel));
/** Usable efforts of the chosen model (all when custom or free-form; empty when the model ignores effort). */
const effortChoices = $derived(selectedOption ? [...selectedOption.efforts] : [...EFFORTS]);
/** Models the post-setup switcher can offer (catalog models of enabled engines + in-use customs). */
const switchSettings = $derived(s.session.settings?.settings);
const switchOptions = $derived<SetupModelOption[]>(switchSettings ? switchableModels(switchSettings) : []);
const switchEntry = (model: string): SetupModelOption | undefined => switchOptions.find((o) => o.id === model);
const genEffortChoices = $derived(switchEntry(genSwitchModel) ? [...(switchEntry(genSwitchModel)?.efforts ?? [])] : [...EFFORTS]);
const answerEffortChoices = $derived(switchEntry(answerSwitchModel) ? [...(switchEntry(answerSwitchModel)?.efforts ?? [])] : [...EFFORTS]);
/** The engine generation uses now; other engines' missing logins are not problems for this person. */
const activeEngine = $derived(s.session.settings?.settings.defaultGenEngine);
/** Previous selections the re-setup command keeps (loaded settings); absent when unknown. */
function setupCtxFor(engine: EngineId): SetupContext {
  return setupContextFor(engine, s.session.settings?.settings);
}
const museSetup = $derived(setupCommandFor("generic", setupCtxFor("generic"), s.session.settings?.launcher) ?? "");
const claudeSetup = $derived(setupCommandFor("claude-cli", {}, s.session.settings?.launcher) ?? "");
const codexSetup = $derived(setupCommandFor("codex-cli", setupCtxFor("codex-cli"), s.session.settings?.launcher) ?? "");
const setupHttp = $derived(["ollama", "lmstudio", "openai"].includes(simpleProvider) || (simpleProvider === "grok" && useApi && !useGrokCli));
const authProvider = $derived(PROVIDER_AUTH_IDS.includes(simpleProvider as ProviderAuthId) ? (simpleProvider as ProviderAuthId) : null);
const authCommand = $derived(authProvider ? providerAuthCommand(authProvider, s.session.settings?.launcher) : "");
const setupLocalApi = $derived(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\/v1\/?$/u.test(simpleBaseUrl));
/** Price-known catalog entries need no explicit prices (same list the CLI reads). */
const setupPriceKnown = $derived(setupModelPriceKnown(simpleProvider, { api: useApi, cli: guidedCli }, modelSlug));
const setupPrices = $derived(
  simpleProvider === "openai" ||
    (simpleProvider === "codex" && useCodexNative && setupPriceKnown === false) ||
    (simpleProvider === "muse" && setupPriceKnown === false) ||
    (simpleProvider === "grok" && (useApi || useGrokCli) && setupPriceKnown === false) ||
    (simpleProvider === "antigravity" && useAntigravityCli && setupPriceKnown === false) ||
    (["ollama", "lmstudio"].includes(simpleProvider) && setupPriceKnown === null && (!setupLocalApi || /(?:[:-]cloud)$/i.test(modelSlug))),
);
const PROVIDER_NAMES: Record<SetupProvider, string> = {
  claude: "Claude Code",
  muse: "Muse",
  grok: "Grok Build",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openai: "",
  codex: "Codex",
  cursor: "Cursor",
  antigravity: "Antigravity",
};
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
  baseUrl = cfg.engines.generic.api?.baseUrl ?? "";
  keyEnv = cfg.engines.generic.api?.keyEnv ?? "";
  inputPrice = cfg.engines.generic.pricing?.inPerMTok;
  outputPrice = cfg.engines.generic.pricing?.outPerMTok;
  cachePrice = cfg.engines.generic.pricing?.cacheReadPerMTok;
  timeoutSeconds = cfg.engines.generic.turnMs === undefined ? undefined : cfg.engines.generic.turnMs / 1000;
  if (provider === "generic") {
    if (model.includes("muse-")) chooseSetup("muse");
    else if (model.includes("grok-")) chooseSetup("grok");
    else if (protocol === "openai-chat") chooseSetup(baseUrl.includes(":11434/") ? "ollama" : baseUrl.includes(":1234/") ? "lmstudio" : "openai");
    if (protocol === "openai-chat" && simpleProvider === "grok") useApi = true;
    applyQuickModel(model);
    simpleEffort = cfg.reasoning.gen;
    if (protocol === "openai-chat") {
      simpleBaseUrl = baseUrl;
      simpleKeyEnv = keyEnv;
      simpleInputPrice = inputPrice;
      simpleOutputPrice = outputPrice;
    }
  } else if (provider === "codex-cli") {
    chooseSetup("codex");
    applyQuickModel(`codex:${cfg.engines["codex-cli"].model}`);
    simpleEffort = cfg.reasoning.gen;
    codexMaxUsd = cfg.engines["codex-cli"].maxEstimatedSpendUsd;
  } else if (provider === "grok-cli") {
    chooseSetup("grok");
    useGrokCli = true;
    applyQuickModel(`grok:${cfg.engines["grok-cli"].model}`);
    simpleEffort = cfg.reasoning.gen;
  } else if (provider === "antigravity-cli") {
    chooseSetup("antigravity");
    useAntigravityCli = true;
    applyQuickModel(`antigravity:${cfg.engines["antigravity-cli"].model}`);
    simpleEffort = cfg.reasoning.gen;
  }
  genSwitchModel = cfg.models.genModule;
  genSwitchEffort = cfg.reasoning.gen;
  answerSwitchModel = cfg.models.answer;
  answerSwitchEffort = cfg.reasoning.answer;
  initialized = true;
});

function chooseSetup(value: SetupProvider) {
  simpleProvider = value;
  useApi = false;
  useGrokCli = false;
  useAntigravityCli = false;
  useCodexNative = true;
  loginResult = "";
  customModel = false;
  customText = "";
  simpleModel = setupDefaultModel(value, {});
  simpleEffort = setupDefaultEffort(value);
  simpleBaseUrl =
    value === "grok"
      ? "https://api.x.ai/v1"
      : value === "ollama"
        ? "http://127.0.0.1:11434/v1"
        : value === "lmstudio"
          ? "http://127.0.0.1:1234/v1"
          : value === "openai"
            ? "https://api.openai.com/v1"
            : "";
  simpleKeyEnv = value === "grok" ? "XAI_API_KEY" : value === "openai" ? "OPENAI_API_KEY" : "";
  simpleInputPrice = undefined;
  simpleOutputPrice = undefined;
  guidedCommand = "";
  guidedError = false;
}

/** Keep the previous grok model only when it belongs to the newly selected mode; custom text is kept. */
function afterGrokModeChange() {
  const opts = setupModelOptions("grok", { api: useApi, cli: useGrokCli });
  if (!customModel && !opts.some((o) => o.id === simpleModel)) {
    simpleModel = setupDefaultModel("grok", { api: useApi, cli: useGrokCli });
    simpleEffort = setupDefaultEffort("grok");
  }
  guidedCommand = "";
  guidedError = false;
}

/** Keep the previous Antigravity model only when it belongs to the CLI mode; custom text is kept. */
function afterAntigravityModeChange() {
  const opts = setupModelOptions("antigravity", { cli: useAntigravityCli });
  if (!customModel && !opts.some((o) => o.id === simpleModel)) {
    simpleModel = setupDefaultModel("antigravity", { cli: useAntigravityCli });
    simpleEffort = setupDefaultEffort("antigravity");
  }
  guidedCommand = "";
  guidedError = false;
}

function selectQuickModel(value: string) {
  guidedCommand = "";
  guidedError = false;
  if (value === "__custom") {
    customModel = true;
    return;
  }
  customModel = false;
  simpleModel = value;
  const opt = modelOptions.find((o) => o.id === value);
  if (opt && opt.efforts.length > 0 && !(opt.efforts as readonly string[]).includes(simpleEffort))
    simpleEffort = opt.defaultEffort ?? setupDefaultEffort(simpleProvider);
}

function selectSwitchModel(kind: "gen" | "answer", value: string) {
  switchSaved = null;
  switchError = null;
  if (kind === "gen") genSwitchModel = value;
  else answerSwitchModel = value;
  const entry = switchEntry(value);
  const effort = kind === "gen" ? genSwitchEffort : answerSwitchEffort;
  if (entry && entry.efforts.length > 0 && !(entry.efforts as readonly string[]).includes(effort)) {
    const next = entry.defaultEffort ?? effort;
    if (kind === "gen") genSwitchEffort = next;
    else answerSwitchEffort = next;
  }
}

async function saveSwitch(kind: "gen" | "answer") {
  if (switchSaving) return;
  const model = (kind === "gen" ? genSwitchModel : answerSwitchModel) as ModelId;
  switchSaving = kind;
  switchSaved = null;
  switchError = null;
  try {
    const effort = kind === "gen" ? genSwitchEffort : answerSwitchEffort;
    const entry = switchEntry(model);
    const withReasoning = !entry || entry.efforts.length > 0;
    const patch: DeepPartial<GlobalSettings> =
      kind === "gen"
        ? {
            models: { genModule: model, genOverview: model, genLeaf: model },
            ...(withReasoning ? { reasoning: { gen: effort, genOverview: effort } } : {}),
          }
        : {
            models: { answer: model, patch: model, agent: model, judge: model, rewrite: model, escalate: model },
            ...(withReasoning ? { reasoning: { answer: effort, patch: effort, agent: effort } } : {}),
          };
    // The server refusal carries `params.reason`; show its i18n reason and the re-setup command.
    const err = await s.prefs.patchDetailed(patch);
    if (err) {
      const reason = typeof err.params?.reason === "string" ? err.params.reason : undefined;
      const key = switchErrorKey(reason);
      switchError = { kind, key, command: key === "settings.switchBadEffort" ? null : switchSetupHint(model) };
      return;
    }
    await s.session.loadSettings();
    switchSaved = kind;
  } catch {
    switchError = { kind, key: "settings.providerInvalid", command: switchSetupHint(model) };
  } finally {
    switchSaving = null;
  }
}

function applyQuickModel(fullId: string) {
  const opts = setupModelOptions(simpleProvider, { api: useApi, cli: guidedCli });
  if (opts.some((o) => o.id === fullId)) {
    customModel = false;
    customText = "";
    simpleModel = fullId;
  } else if (opts.length > 0) {
    customModel = true;
    customText = fullId.replace(/^(codex|grok|antigravity|generic):/, "");
    simpleModel = "";
  } else {
    customModel = false;
    customText = "";
    simpleModel = fullId.replace(/^generic:/, "");
  }
}

async function signIn() {
  if (!authProvider || signingIn) return;
  signingIn = true;
  const selected = authProvider;
  loginResult = "";
  try {
    const result = await s.api.call("POST /settings/provider-login", { params: {}, body: { provider: selected } });
    if (authProvider === selected) loginResult = result.opened ? "opened" : "fallback";
  } catch {
    if (authProvider === selected) loginResult = "fallback";
  } finally {
    signingIn = false;
  }
}

function createSetup(e: SubmitEvent) {
  e.preventDefault();
  guidedError = false;
  guidedCommand = "";
  try {
    guidedCommand = providerSetupCommand(
      {
        provider: simpleProvider,
        api: useApi,
        native: simpleProvider === "codex" && useCodexNative,
        cli: guidedCli,
        maxEstimatedUsd: codexMaxUsd,
        model: modelOptions.length > 0 ? modelSlug : effectiveModel,
        repo: setupRepo || s.workspace.status?.info.root,
        baseUrl: simpleBaseUrl,
        keyEnv: simpleKeyEnv,
        inputPrice: simpleInputPrice,
        outputPrice: simpleOutputPrice,
        ...(setupEffort && effortChoices.length > 0 ? { effort: simpleEffort } : {}),
      },
      s.session.settings?.launcher,
    );
  } catch {
    guidedError = true;
  }
}

async function reloadProvider() {
  if (reloading) return;
  reloading = true;
  try {
    const [settings] = await Promise.all([s.session.loadSettings(), s.session.loadEngines()]);
    initialized = false;
    s.gen.estimates.clear();
    s.gen.sectionEstimates.clear();
    if (settings) await s.gen.setEngine(settings.settings.defaultGenEngine);
  } finally {
    reloading = false;
  }
}

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
  if (saving || !initialized || provider === "codex-cli") return;
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
            baseUrl,
            keyEnv,
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
        (next.protocol === "openai-chat" && (current.api?.baseUrl !== next.api?.baseUrl || current.api?.keyEnv !== next.api?.keyEnv)) ||
        current.turnMs !== next.turnMs ||
        current.pricing?.inPerMTok !== next.pricing?.inPerMTok ||
        current.pricing?.outPerMTok !== next.pricing?.outPerMTok ||
        current.pricing?.cacheReadPerMTok !== next.pricing?.cacheReadPerMTok
      ) {
        setupCommand = genericProviderCommand(patch, s.session.settings?.launcher);
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

  <section id="engines" bind:this={enginesSection}>
    <h2>{t("settings.engines")}</h2>
    <form onsubmit={createSetup} oninput={() => { guidedCommand = ""; guidedError = false; }}>
      <p class="note">{t("settings.quickSetupLead")}</p>
      <label class="row"><span>{t("settings.quickProvider")}</span><select value={simpleProvider} onchange={(e) => chooseSetup(e.currentTarget.value as SetupProvider)}>
        {#each SETUP_PROVIDERS as name (name)}<option value={name}>{name === "openai" ? t("settings.openaiCompatible") : PROVIDER_NAMES[name]}</option>{/each}
      </select></label>
      {#if simpleProvider === "grok"}
        <label class="row check"><input type="checkbox" bind:checked={useApi} onchange={() => { if (useApi) useGrokCli = false; afterGrokModeChange(); }} /><span>{t("settings.useApi")}</span></label>
        <label class="row check"><input type="checkbox" bind:checked={useGrokCli} onchange={() => { if (useGrokCli) useApi = false; afterGrokModeChange(); }} /><span>{t("settings.useGrokCli")}</span></label>
      {/if}
      {#if simpleProvider === "antigravity"}
        <label class="row check"><input type="checkbox" bind:checked={useAntigravityCli} onchange={() => afterAntigravityModeChange()} /><span>{t("settings.useAntigravityCli")}</span></label>
      {/if}
      {#if simpleProvider === "codex"}
        <label class="row check"><input type="checkbox" bind:checked={useCodexNative} /><span>{t("settings.codexNative")}</span></label>
        {#if useCodexNative}
          <label class="row"><span>{t("settings.codexMaxUsd")}</span><input type="number" min="0.001" step="any" required bind:value={codexMaxUsd} /></label>
          <p class="note">{t("settings.codexEstimateHint")}</p>
        {/if}
      {/if}
      {#if authProvider && !(simpleProvider === "grok" && useApi)}
        {#if simpleProvider === "antigravity"}
          <p class="note">{t("settings.antigravityLogin")}</p>
          <a class="btn btn-sec btn-s" href="https://antigravity.google/docs/cli/install/" target="_blank" rel="noopener noreferrer">{t("settings.officialLoginGuide")}</a>
        {:else}
          <button type="button" class="btn btn-sec btn-s" disabled={signingIn} onclick={signIn}>{t(signingIn ? "app.loading" : "settings.officialSignIn", { provider: PROVIDER_NAMES[simpleProvider] })}</button>
          <p class="note">{t(simpleProvider === "ollama" ? "settings.ollamaLogin" : "settings.subscriptionLogin")}</p>
        {/if}
        {#if loginResult === "opened"}<p class="note" role="status">{t("settings.loginOpened")}</p>{/if}
        {#if loginResult === "fallback"}
          <p class="note" role="status">{t("settings.loginFallback")}</p>
          {#if !s.session.settings?.launcher}<p class="note">{t("settings.quickSetupCwd")}</p>{/if}
          <pre class="mono">{authCommand}</pre>
          <button type="button" class="btn btn-sec btn-s" onclick={() => copyText(authCommand, s, "copy.command")}>{t("settings.copyLogin")}</button>
        {/if}
      {/if}
      {#if setupExternal}
        <p class="note">{t("settings.externalSetup")}</p>
        <label class="row"><span>{t("settings.setupRepo")}</span><input class="mono" bind:value={setupRepo} required={!s.workspace.status?.info.root} placeholder={s.workspace.status?.info.root ?? "/path/to/repository"} /></label>
      {:else}
        {#if modelOptions.length > 0}
          <label class="row"><span>{t("settings.quickModel")}</span><select value={customModel ? "__custom" : simpleModel} onchange={(e) => selectQuickModel(e.currentTarget.value)}>
            {#each modelOptions as o (o.id)}<option value={o.id}>{o.displayName}</option>{/each}
            <option value="__custom">{t("settings.quickModelCustom")}</option>
          </select></label>
          {#if customModel}
            <label class="row"><span>{t("settings.quickModelCustom")}</span><input class="mono" bind:value={customText} placeholder="model-name" /></label>
          {/if}
        {:else}
          <label class="row"><span>{t(["ollama", "lmstudio", "openai"].includes(simpleProvider) ? "settings.quickModel" : "settings.quickModelOptional")}</span><input class="mono" bind:value={simpleModel} required={["ollama", "lmstudio", "openai"].includes(simpleProvider)} placeholder="model-name" /></label>
        {/if}
        {#if setupHttp}
          <label class="row"><span>{t("settings.apiUrl")}</span><input class="mono" type="url" required bind:value={simpleBaseUrl} /></label>
          {#if simpleProvider === "grok" || simpleProvider === "openai" || !setupLocalApi}
            <label class="row"><span>{t("settings.keyEnv")}</span><input class="mono" required={!setupLocalApi} bind:value={simpleKeyEnv} /></label>
            <p class="note">{t("settings.keyEnvHint")}</p>
          {/if}
        {/if}
          {#if setupPrices}
            <p class="note">{t("settings.pricingHint")}</p>
            <label class="row"><span>{t("settings.priceInput")}</span><input type="number" min="0" step="any" required bind:value={simpleInputPrice} /></label>
            <label class="row"><span>{t("settings.priceOutput")}</span><input type="number" min="0" step="any" required bind:value={simpleOutputPrice} /></label>
          {/if}
        {#if setupEffort}
          {#if effortChoices.length > 0}
            <label class="row"><span>{t("settings.quickEffort")}</span><select bind:value={simpleEffort}>{#each effortChoices as level (level)}<option value={level}>{level}</option>{/each}</select></label>
          {:else}
            <p class="note">{t("settings.quickEffortUnsupported")}</p>
          {/if}
          {#if simpleProvider === "grok" && useGrokCli && simpleEffort !== "low"}<p class="note">{t("settings.grokSlowWarn")}</p>{/if}
        {/if}
        {#if simpleProvider === "muse"}<p class="note">{t("settings.museSubscription")} <a href="https://dev.meta.ai/docs/muse-code/auth" target="_blank" rel="noopener noreferrer">{t("settings.officialLoginGuide")}</a></p><p class="note">{t("settings.museContributor")}</p>{/if}
      {/if}
      <button type="submit" class="btn btn-pri btn-s">{t("settings.createSetup")}</button>
      {#if guidedError}<p class="bad" role="alert">{t("settings.setupInvalid")}</p>{/if}
      {#if guidedCommand}
        <p class="note">{t("settings.quickSetupSteps")}</p>
        {#if !s.session.settings?.launcher}<p class="note">{t("settings.quickSetupCwd")}</p>{/if}
        <pre class="mono">{guidedCommand}</pre>
        <button type="button" class="btn btn-sec btn-s" onclick={() => copyText(guidedCommand, s, "copy.command")}>{t("settings.copySetup")}</button>
      {/if}
      <button type="button" class="btn btn-sec btn-s" disabled={reloading} onclick={reloadProvider}>{t(reloading ? "app.loading" : "settings.reloadSettings")}</button>
    </form>
    <details>
      <summary>{t("settings.advancedProvider")}</summary>
    <form onsubmit={saveProvider} oninput={() => (saved = false)}>
      <label class="row"><span>{t("settings.provider")}</span><select bind:value={provider} disabled={!initialized}>
        {#if provider === "codex-cli"}<option value="codex-cli" disabled>codex-cli</option>{/if}
        {#if provider === "grok-cli"}<option value="grok-cli" disabled>grok-cli</option>{/if}
        {#if provider === "antigravity-cli"}<option value="antigravity-cli" disabled>antigravity-cli</option>{/if}
        {#each ADVANCED_ENGINES as engine (engine)}<option value={engine}>{engine}</option>{/each}
      </select></label>
      <button type="button" class="btn btn-sec btn-s" disabled={!initialized} onclick={musePreset}>{t("settings.musePreset")}</button>
      {#if provider === "generic"}
        <label class="row"><span>{t("settings.model")}</span><input class="mono" required bind:value={model} placeholder="generic:model-id" /></label>
        <label class="row"><span>{t("settings.reasoning")}</span><select bind:value={reasoning}>{#each ["low", "medium", "high", "xhigh", "max"] as level (level)}<option value={level}>{level}</option>{/each}</select></label>
        <label class="row"><span>{t("settings.protocol")}</span><select bind:value={protocol}><option value="text">text</option><option value="muse-jsonl">Muse JSONL</option><option value="openai-chat">OpenAI API</option></select></label>
        {#if protocol === "openai-chat"}
          <label class="row"><span>{t("settings.apiUrl")}</span><input class="mono" type="url" required bind:value={baseUrl} /></label>
          <label class="row"><span>{t("settings.keyEnv")}</span><input class="mono" bind:value={keyEnv} /></label>
          <p class="note">{t("settings.keyEnvHint")}</p>
        {:else}
          <label class="row argv"><span>{t("settings.argv")}</span><textarea class="mono" required bind:value={argv} rows="5" spellcheck="false"></textarea></label>
          <p class="note">{t("settings.argvHint")}</p>
        {/if}
        <p class="note">{t("settings.pricingHint")}</p>
        <label class="row"><span>{t("settings.timeout")}</span><input type="number" min="1" max="3600" step="1" bind:value={timeoutSeconds} /></label>
        <label class="row"><span>{t("settings.priceInput")}</span><input type="number" min="0" step="any" required bind:value={inputPrice} /></label>
        <label class="row"><span>{t("settings.priceOutput")}</span><input type="number" min="0" step="any" required bind:value={outputPrice} /></label>
        <label class="row"><span>{t("settings.priceCache")}</span><input type="number" min="0" step="any" required bind:value={cachePrice} /></label>
        {#if model === "generic:muse-spark-1.3-contributor"}<p class="note">{t("settings.museContributor")} <a href="https://dev.meta.ai/docs/pricing-rate-limits" target="_blank" rel="noopener noreferrer">{t("settings.providerPolicy")}</a></p>{/if}
      {/if}
      {#if provider === "codex-cli"}<p class="note">{t("settings.codexGuidedHint")}</p>{/if}
      <button type="submit" class="btn btn-pri btn-s" disabled={!initialized || saving || provider === "codex-cli"}>{t(saving ? "settings.providerSaving" : "settings.providerSave")}</button>
      {#if setupCommand}
        <p class="note">{t("settings.providerSetup")}</p>
        {#if !s.session.settings?.launcher}<p class="note">{t("settings.quickSetupCwd")}</p>{/if}
        <pre class="mono">{setupCommand}</pre>
        <button type="button" class="btn btn-sec btn-s" onclick={() => copyText(setupCommand, s, "copy.command")}>{t("settings.copySetup")}</button>
      {/if}
      {#if providerError}<p class="bad" role="alert">{t("settings.providerInvalid")}</p>{/if}
      {#if saved}<p class="note" role="status">{t("settings.providerSaved")}</p>{/if}
    </form>
    </details>
    {#each s.session.engines ?? [] as e (e.engine)}
      {@const active = e.engine === activeEngine}
      {@const relevant = active || e.installed || e.path !== undefined}
      {@const museGone = museUpdated(e)}
      {@const claudeGone = claudeBinaryChanged(e)}
      {@const codexGone = codexBinaryChanged(e)}
      {@const codexVersion = codexVerifiedVersion(e)}
      <div class="eng card" class:idle={!relevant}>
        <b class="mono">{e.engine}</b>
        {#if active}<span class="active">{t("settings.engineActive")}</span>{/if}
        <span>{e.installed ? (e.version ? t("settings.installed", { version: e.version }) : t("settings.installedPlain")) : t(relevant ? "settings.notInstalled" : "settings.notConfigured")}</span>
        {#if relevant}
          <span>{t(`statusbar.auth.${authDisplayKind(e)}`)}</span>
          {#each e.problems as p (p.code)}<span class="bad">{t(`error.${p.code}`)}</span>{/each}
        {/if}
        {#if e.followed}
          <p class="note">{t("engine.followed", { from: e.followed.from, to: e.followed.to })}</p>
        {/if}
        {#if museGone}
          <p class="note fix">{t("settings.museUpdated")}</p>
          <pre class="mono">{museSetup}</pre>
          <button type="button" class="btn btn-sec btn-s" onclick={() => copyText(museSetup, s, "copy.command")}>{t("settings.copySetup")}</button>
        {/if}
        {#if claudeGone && claudeSetup}
          <p class="note fix">{t("settings.claudeChanged")}</p>
          <pre class="mono">{claudeSetup}</pre>
          <button type="button" class="btn btn-sec btn-s" onclick={() => copyText(claudeSetup, s, "copy.command")}>{t("settings.copySetup")}</button>
        {/if}
        {#if codexGone && codexSetup}
          <p class="note fix">{t("settings.codexChanged")}</p>
          <pre class="mono">{codexSetup}</pre>
          <button type="button" class="btn btn-sec btn-s" onclick={() => copyText(codexSetup, s, "copy.command")}>{t("settings.copySetup")}</button>
        {/if}
        {#if codexVersion}
          <p class="note fix">{t("settings.codexVersion", { version: codexVersion })}</p>
        {/if}
      </div>
    {:else}
      <p class="note">{t("app.loading")}</p>
    {/each}
  </section>

  <section>
    <h2>{t("settings.modelSwitch")}</h2>
    <p class="note">{t("settings.modelSwitchLead")}</p>
    {#if switchOptions.length > 0}
      <div class="group">
        <h3 class="gname">{t("settings.genGroup")}</h3>
        <label class="row"><span>{t("settings.quickModel")}</span><select value={genSwitchModel} onchange={(e) => selectSwitchModel("gen", e.currentTarget.value)}>
          {#each switchOptions as o (o.id)}<option value={o.id}>{o.displayName}</option>{/each}
        </select></label>
        {#if genEffortChoices.length > 0}
          <label class="row"><span>{t("settings.quickEffort")}</span><select bind:value={genSwitchEffort}>{#each genEffortChoices as level (level)}<option value={level}>{level}</option>{/each}</select></label>
        {:else}
          <p class="note">{t("settings.quickEffortUnsupported")}</p>
        {/if}
        {#if genSwitchModel.startsWith("grok:") && genSwitchEffort !== "low"}<p class="note">{t("settings.grokSlowWarn")}</p>{/if}
        <button type="button" class="btn btn-pri btn-s" disabled={switchSaving !== null} onclick={() => saveSwitch("gen")}>{t(switchSaving === "gen" ? "settings.providerSaving" : "settings.providerSave")}</button>
        {#if switchSaved === "gen"}<p class="note" role="status">{t("settings.providerSaved")}</p>{/if}
        {#if switchError?.kind === "gen"}
          <p class="bad" role="alert">{t(switchError.key)}</p>
          {#if switchError.command}<pre class="mono">{switchError.command}</pre>{/if}
        {/if}
      </div>
      <div class="group">
        <h3 class="gname">{t("settings.answerGroup")}</h3>
        <label class="row"><span>{t("settings.quickModel")}</span><select value={answerSwitchModel} onchange={(e) => selectSwitchModel("answer", e.currentTarget.value)}>
          {#each switchOptions as o (o.id)}<option value={o.id}>{o.displayName}</option>{/each}
        </select></label>
        {#if answerEffortChoices.length > 0}
          <label class="row"><span>{t("settings.quickEffort")}</span><select bind:value={answerSwitchEffort}>{#each answerEffortChoices as level (level)}<option value={level}>{level}</option>{/each}</select></label>
        {:else}
          <p class="note">{t("settings.quickEffortUnsupported")}</p>
        {/if}
        {#if answerSwitchModel.startsWith("grok:") && answerSwitchEffort !== "low"}<p class="note">{t("settings.grokSlowWarn")}</p>{/if}
        <button type="button" class="btn btn-pri btn-s" disabled={switchSaving !== null} onclick={() => saveSwitch("answer")}>{t(switchSaving === "answer" ? "settings.providerSaving" : "settings.providerSave")}</button>
        {#if switchSaved === "answer"}<p class="note" role="status">{t("settings.providerSaved")}</p>{/if}
        {#if switchError?.kind === "answer"}
          <p class="bad" role="alert">{t(switchError.key)}</p>
          {#if switchError.command}<pre class="mono">{switchError.command}</pre>{/if}
        {/if}
      </div>
    {/if}
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
  .gname {
    font-size: var(--fs-ui-l);
    color: var(--ink);
    margin: 18px 0 4px;
  }
  .group {
    margin-bottom: 12px;
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
  summary { cursor: pointer; padding: 12px 0; }
  pre { overflow-x: auto; padding: 12px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--r-input); }
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
  .eng.idle {
    color: var(--muted);
  }
  .active {
    font-weight: var(--fw-strong);
  }
  .eng .fix,
  .eng pre {
    flex-basis: 100%;
    margin: 0;
  }
</style>
