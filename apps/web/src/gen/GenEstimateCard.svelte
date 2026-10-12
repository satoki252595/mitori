<!--
  Generation estimate card (ux.md §4.2.4 + R1; contract `GenEstimateCardProps`; prototype `01-first-run-map`): the
  card IS the confirmation — one click (or Enter on the focused button) starts. Three effort tiles, the main line
  with the 生成 button, what the run reads and writes, the engine line (first-run pin, 5h window), the two other
  paths (your own session, API key) and 「内訳と経路 ▾」. R1: API-equivalent $ stays the main figure with the
  billing state under it (UXP-09), ranges while uncalibrated (UXP-30), the 5h line with the plan prior (UXP-08),
  a non-collapsible data-disclosure row until acknowledged — only a click after the row was visible ≥ 1 s counts
  as the acknowledgement (UXP-04, AC-U-DP). `detecting`: engines are being probed (no button yet).
-->
<script lang="ts">
import type { Effort, EngineId, EngineStatus, GenEstimate, ReasoningEffort, ScanSummaryView, SubscriptionWindow } from "@mitori/core";
import { untrack } from "svelte";
import type { LauncherCommand } from "../settings/provider.ts";
import { authDisplayKind, fmtHm, fmtUsdImpl } from "../shell/fmt.ts";
import { hasKey } from "../shell/i18n.ts";
import { t } from "../shell/index.ts";
import {
  billingLine,
  detailLine,
  EFFORTS,
  figures,
  isByteUpperEstimate,
  moduleChapters,
  narrowerEffort,
  sessionMode,
  startMode,
  tileFigures,
  windowLine,
} from "./estimate.ts";
import { VisibleClock } from "./visibility.ts";

let {
  estimates,
  effort,
  engine,
  reasoning,
  window: win,
  policyAcked,
  breakdownOpen,
  engineStatus,
  detecting = false,
  scan,
  busy,
  oneffort,
  onengine,
  onstart,
  onack,
  oncopy,
  onsettings,
  initialClock = null,
  repo,
  launcher,
  genericProtocol = "text",
  initialBreakdown = null,
}: {
  estimates: Partial<Record<Effort, GenEstimate>>;
  effort: Effort;
  engine: EngineId;
  reasoning?: ReasoningEffort | undefined;
  window: SubscriptionWindow | null;
  policyAcked: boolean;
  breakdownOpen: boolean;
  engineStatus: EngineStatus | null;
  /** Engines not probed yet: tiles and the button wait. */
  detecting?: boolean;
  scan: ScanSummaryView | null;
  busy: boolean;
  oneffort: (e: Effort) => void;
  onengine: (e: EngineId) => void;
  onstart: (opts: { notBefore?: string }) => void;
  onack: (shownAt: string) => Promise<unknown>;
  oncopy: (text: string) => void;
  /** 「変更」 of a first-run pin (settings page). */
  onsettings?: () => void;
  initialClock?: VisibleClock | null;
  repo?: string | undefined;
  launcher?: LauncherCommand | undefined;
  /** Generic stdout protocol (usage-less `text` / `muse-jsonl` estimates are byte-upper); other engines ignore it. */
  genericProtocol?: "text" | "muse-jsonl" | "openai-chat";
  initialBreakdown?: typeof import("./GenBreakdown.svelte").default | null | undefined;
} = $props();

let overageOk = $state(false);
const est = $derived(estimates[effort] ?? null);
const main = $derived(est ? figures(est, true) : null);
const bill = $derived(est && main ? billingLine(est, main.usd, t) : null);
const mode = $derived(est ? startMode(est, engine, overageOk, { repo, launcher }) : null);
const byteUpper = $derived(isByteUpperEstimate(engine, genericProtocol));
const util = $derived(win?.fiveHour?.utilization ?? null);
const policyKey = $derived.by(() => {
  if (engine === "generic" && est?.model.includes("muse-spark-1.3-contributor")) return "policy.museContributor";
  const k = engineStatus?.dataPolicyKey ? `policy.${engineStatus.dataPolicyKey.replace(/[^a-zA-Z0-9]/g, "_")}` : "";
  return k && hasKey(k) ? k : "policy.default";
});
const pin = $derived(engineStatus?.pin ?? null);
const api = $derived(est?.alternatives.find((a) => a.engine === "anthropic-api") ?? null);
const sessionCmd = $derived(sessionMode(effort, { repo, launcher }));

// disclosure visibility (≥ 1 s in view before a click may acknowledge it)
let disclosure: HTMLElement | undefined = $state();
const clock = untrack(() => initialClock ?? new VisibleClock());
let nudge = $state(false);
$effect(() => {
  if (!disclosure || policyAcked) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) clock.entry(en.isIntersecting && en.intersectionRatio >= 0.9, performance.now(), () => new Date().toISOString());
    },
    { threshold: [0, 0.9, 1] },
  );
  io.observe(disclosure);
  return () => io.disconnect();
});

function seenEnough(): boolean {
  return clock.visibleMs(performance.now()) >= 1000;
}

let acking = false;
async function start(opts: { notBefore?: string } = {}) {
  if (busy || acking || !est) return;
  if (!policyAcked) {
    if (!seenEnough()) {
      nudge = true;
      setTimeout(() => (nudge = false), 1200);
      return;
    }
    // recorded before the run is requested: the daemon may refuse a run on an engine without an ack
    acking = true;
    try {
      await onack(clock.shownAt ?? new Date().toISOString());
    } finally {
      acking = false;
    }
  }
  onstart(opts);
}

const windowText = $derived(est ? windowLine(est, util, engineStatus?.plan ?? null, t) : "");
let Breakdown = $state.raw(untrack(() => initialBreakdown));
const loadBreakdown = () => {
  if (!Breakdown) void import("./GenBreakdown.svelte").then((m) => (Breakdown = m.default));
};
$effect(() => {
  if (breakdownOpen) loadBreakdown();
});
const resetAt = $derived(win?.fiveHour?.resetsAt ?? null);
/** 「範囲を絞る」 on the card = the next smaller effort (its estimate is already fetched; switching costs 0 requests). */
const narrower = $derived(narrowerEffort(effort));
const scopeText = $derived(est ? t(`gen.card.scope.${effort}`, { n: moduleChapters(est) }) : "");
</script>

<section class="est card" aria-labelledby="est-title" aria-busy={detecting || undefined} data-chrome>
  <h2 id="est-title">{t("gen.card.title")}</h2>

  <div class="eff" role="radiogroup" aria-label={t("gen.card.effortLabel")}>
    {#each EFFORTS as e (e)}
      {@const x = estimates[e]}
      {@const f = x ? tileFigures(x) : null}
      <label class:sel={e === effort}>
        <input type="radio" name="mitori-effort" value={e} checked={e === effort} onchange={() => oneffort(e)} />
        <span class="tt">{t(`gen.effort.${e}`)}{#if e === "standard"}<span class="rec">{t("gen.card.recommended")}</span>{/if}</span>
        {#if f}
          <span class="v mono">{f.tokens}{#if !f.range}<span class="u">tok</span>{/if}</span>
          <span class="v2">{f.usd}</span>
          <span class="v2">{f.time}</span>
        {:else}
          <span class="v skel">&nbsp;</span><span class="v2 skel">&nbsp;</span><span class="v2 skel">&nbsp;</span>
        {/if}
      </label>
    {/each}
  </div>

  {#if !policyAcked && !detecting}
    <p class="disc" class:nudge bind:this={disclosure} data-testid="disclosure">
      {t(policyKey, {
        engine,
        files: scan ? scan.included.toLocaleString() : "–",
        excluded: scan ? (scan.files - scan.included).toLocaleString() : "–",
      })}
    </p>
  {/if}

  <div class="main">
    {#if est && main && mode && !detecting}
      <p class="sum">
        <span class="lead">{t("gen.card.mainLine", { effort: t(`gen.effort.${effort}`), tokens: main.tokens, usd: main.usd, time: main.time })}{#if main.range}<span class="unc">{t("gen.card.uncalibrated")}</span>{/if}{#if byteUpper}<span class="unc">{t("gen.card.byteUpper")}</span>{/if}</span>
        {#if bill}<span class="bill" data-tone={bill.tone}>{bill.text}</span>{/if}
      </p>
      {#if mode.kind === "session"}
        <button type="button" class="btn btn-pri go" onclick={() => oncopy(mode.copy)}>{t("gen.card.copySession")}</button>
      {:else if mode.kind === "windowRisk"}
        <!-- window_risk (§16 R11): the main button splits into 4 choices; nothing starts without one of them -->
        <div class="four" data-testid="window-risk">
          <button type="button" class="btn btn-pri" aria-disabled={busy} onclick={() => start()}>{t("gen.card.startNow")}</button>
          {#if resetAt}<button type="button" class="btn btn-sec" onclick={() => start({ notBefore: resetAt })}>{t("gen.card.afterReset", { time: fmtHm(resetAt) })}</button>{/if}
          <button type="button" class="btn btn-sec" onclick={() => onengine("session")}>{t("gen.card.viaSession")}</button>
          {#if narrower}<button type="button" class="btn btn-gh" onclick={() => narrower && oneffort(narrower)}>{t("gen.card.narrow")}</button>{/if}
        </div>
      {:else}
        <button type="button" class="btn btn-pri go" class:warn={mode.kind === "overage"} aria-disabled={busy || (mode.kind === "overage" && !overageOk)} onclick={() => (mode.kind === "overage" && !overageOk ? undefined : start())}
          >{busy ? t("gen.card.starting") : t("gen.card.start")}</button
        >
      {/if}
    {:else}
      <p class="sum">
        {#if detecting}<span class="detect"><span class="spin" aria-hidden="true"></span>{t("gen.card.detecting", { engine })}</span>{:else}<span class="skel lead-skel">&nbsp;</span>{/if}
      </p>
      <button type="button" class="btn btn-pri go" aria-disabled="true">{t("gen.card.start")}</button>
    {/if}
  </div>

  {#if est && !detecting}
    <p class="detail">{scopeText}<span class="sep" aria-hidden="true">&middot;</span>{detailLine(est, t)}{#if reasoning}<span class="sep" aria-hidden="true">&middot;</span>{t("gen.card.reasoning", { effort: reasoning })}{/if}</p>
  {/if}

  {#if mode?.kind === "overage"}
    <label class="ovg"><input type="checkbox" bind:checked={overageOk} /> {t("gen.card.overageAck")}</label>
  {/if}
  {#if est?.confirmReasons.includes("api_key_billing")}
    <p class="sub warn">{t("gen.card.apiKeyBilling", { usd: fmtUsdImpl(est.apiUsd, "gen") })}</p>
  {/if}
  {#if mode?.kind === "session"}
    <ol class="steps">
      {#each [1, 2, 3] as step}<li>{t(`gen.session.step${step}`)}</li>{/each}
    </ol>
  {/if}

  <p class="sub">
    {t("gen.card.supplement", {
      engine: engine,
      auth: t(`gen.card.auth.${authDisplayKind(engineStatus)}`),
      c: est?.concurrency ?? "–",
      window: windowText || t("gen.window.uncalibrated"),
    })}
    {#if pin?.by === "first-run"}
      <span class="pin">{t("gen.card.firstRunPin", { version: pin.version.replace(/\s*\(.*\)$/, "") })}{#if onsettings}<button type="button" class="link-btn" onclick={onsettings}>{t("gen.card.change")}</button>{/if}</span>
    {/if}
  </p>

  <ul class="paths">
    <li>
      <span class="pk" aria-hidden="true">&gt;_</span>
      <span>{t("gen.card.ownSession")}</span>
      <button type="button" class="cmd mono" title={t("gen.card.copySession")} onclick={() => oncopy(sessionCmd.copy)}>{sessionCmd.raw}</button>
    </li>
    <li>
      <span class="pk" aria-hidden="true">$</span>
      <span>{t("gen.card.apiKey")}</span>
      <span class="mono muted">{api ? t("gen.card.apiBatch", { usd: fmtUsdImpl(api.apiUsd, "genMain") }) : t("gen.card.apiOff")}</span>
    </li>
  </ul>

  {#if est}
    <details class="brk" open={breakdownOpen} ontoggle={(e) => e.currentTarget.open && loadBreakdown()}>
      <summary>{t("gen.card.breakdown")}</summary>
      {#if Breakdown}<Breakdown {est} {engine} {onengine} />{/if}
    </details>
  {/if}
</section>

<style>
  .est {
    padding: 22px 24px 14px;
    box-shadow: var(--shadow-soft);
    min-height: 352px;
  }
  h2 {
    font-family: var(--font-serif);
    font-size: 21px;
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 14px;
  }
  .eff {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--rule);
    border-radius: 9px;
    overflow: hidden;
  }
  .eff label {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 10px 12px 9px;
    cursor: pointer;
    min-height: 92px;
    min-width: 0;
    transition: background-color var(--dur-hover-l);
  }
  .eff label + label {
    border-left: 1px solid var(--rule);
  }
  .eff label:hover {
    background: var(--hover);
  }
  .eff input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .eff label:focus-within:has(:focus-visible) {
    outline: var(--focus-w) solid var(--focus-ring);
    outline-offset: -2px;
  }
  .eff .tt {
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--muted);
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .eff .rec {
    font-size: var(--fs-meta);
    color: var(--c-ok);
    font-weight: var(--fw-regular);
  }
  /* one line each in every state and width: figures arriving never change the card height (CLS 0) */
  .eff .v,
  .eff .v2 {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .eff .v {
    font-size: var(--fs-ui);
    color: var(--ink);
    line-height: 1.5;
  }
  .eff .u {
    margin-left: 0.3em;
    color: var(--muted);
    font-size: var(--fs-label);
  }
  .eff .v2 {
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.5;
    font-variant-numeric: tabular-nums;
  }
  .eff label.sel {
    background: var(--paper);
    box-shadow: inset 0 -2px 0 var(--ink);
  }
  .eff label.sel .tt {
    color: var(--ink);
  }
  .disc {
    margin: 12px 0 0;
    padding: 8px 10px;
    border-radius: var(--r-btn);
    background: var(--paper);
    border: 1px solid var(--rule);
    font-size: var(--fs-label);
    line-height: 1.6;
    color: var(--muted);
    transition: border-color var(--dur-hover-l);
  }
  .disc.nudge {
    border-color: var(--accent);
    color: var(--text);
  }
  .main {
    display: flex;
    align-items: center;
    gap: 14px;
    justify-content: space-between;
    padding: 14px 0 6px;
    min-height: 78px;
  }
  .sum {
    margin: 0;
    font-size: var(--fs-ui-m);
    color: var(--ink);
    line-height: 1.5;
    min-width: 0;
    font-variant-numeric: tabular-nums;
    display: flex;
    flex-direction: column;
  }
  .lead {
    font-weight: var(--fw-strong);
  }
  .unc {
    font-weight: var(--fw-regular);
    color: var(--muted);
    font-size: var(--fs-label);
    margin-left: 4px;
  }
  .bill {
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .bill[data-tone="ok"] {
    color: var(--c-ok);
  }
  .bill[data-tone="warn"] {
    color: var(--c-warn);
  }
  .lead-skel {
    display: inline-block;
    width: 14em;
    height: 1.2em;
  }
  .detect {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: var(--fs-ui);
  }
  .spin {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--rule-2);
    border-top-color: var(--ink);
    animation: est-spin 0.9s linear infinite;
  }
  @keyframes est-spin {
    to {
      transform: rotate(1turn);
    }
  }
  .go {
    min-width: 116px;
    height: 44px;
    flex: none;
    font-size: var(--fs-ui-m);
  }
  .four {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }
  .detail {
    margin: 0 0 4px;
    font-size: var(--fs-label);
    line-height: 1.65;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .sep {
    margin: 0 4px;
    color: var(--rule-2);
  }
  .sub {
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.6;
    margin: 8px 0 4px;
    padding-top: 10px;
    border-top: 1px solid var(--rule-soft);
  }
  .sub.warn {
    color: var(--c-warn);
    border: 0;
    padding: 0;
  }
  .pin {
    display: block;
    color: var(--muted);
  }
  .pin .link-btn {
    margin-left: 6px;
  }
  .link-btn {
    color: var(--ink);
    text-decoration: underline;
    text-decoration-color: var(--rule-2);
    text-underline-offset: 3px;
  }
  .paths {
    list-style: none;
    margin: 6px 0 2px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-label);
    color: var(--text);
  }
  .paths li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    min-width: 0;
    white-space: nowrap;
  }
  .paths .pk {
    width: 18px;
    font-family: var(--font-mono);
    color: var(--muted);
    text-align: center;
  }
  .paths .cmd {
    color: var(--muted);
    border-radius: var(--r-btn);
    padding: 2px 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .paths .cmd:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .muted {
    color: var(--muted);
  }
  .ovg {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: var(--fs-label);
    color: var(--c-bad);
  }
  .steps {
    margin: 6px 0;
    padding-left: 1.4em;
    font-size: var(--fs-label);
    color: var(--text);
  }
  .brk {
    font-size: var(--fs-label);
    color: var(--text);
    border-top: 1px solid var(--rule-soft);
    margin-top: 6px;
  }
  .brk summary {
    cursor: pointer;
    color: var(--muted);
    min-height: 32px;
    display: flex;
    align-items: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
