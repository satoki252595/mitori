<!--
  Generation estimate card (ux.md §4.2.4 + R1; contract `GenEstimateCardProps`): the card IS the confirmation —
  one click (or Enter on the focused button) starts. R1: API-equivalent $ stays the main figure with the billing
  state on the same line (UXP-09), ranges while uncalibrated (UXP-30), the 5h line with the plan prior
  (UXP-08), a non-collapsible data-disclosure row until acknowledged — only a click after the row was visible
  ≥ 1 s counts as the acknowledgement (UXP-04, AC-U-DP).
-->
<script lang="ts">
import type { Effort, EngineId, EngineStatus, GenEstimate, ScanSummaryView, SubscriptionWindow } from "@mitori/core";
import { fmtHm, fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { hasKey } from "../shell/i18n.ts";
import { t } from "../shell/index.ts";
import { billingLine, EFFORTS, estimateValidity, figures, narrowerEffort, stageRows, startMode, windowLine } from "./estimate.ts";
import { VisibleClock } from "./visibility.ts";

let {
  estimates,
  effort,
  engine,
  window: win,
  policyAcked,
  breakdownOpen,
  engineStatus,
  scan,
  busy,
  collapsed,
  oneffort,
  onengine,
  onstart,
  onack,
  oncopy,
  onexpand,
}: {
  estimates: Partial<Record<Effort, GenEstimate>>;
  effort: Effort;
  engine: EngineId;
  window: SubscriptionWindow | null;
  policyAcked: boolean;
  breakdownOpen: boolean;
  engineStatus: EngineStatus | null;
  scan: ScanSummaryView | null;
  busy: boolean;
  collapsed: boolean;
  oneffort: (e: Effort) => void;
  onengine: (e: EngineId) => void;
  onstart: (opts: { notBefore?: string }) => void;
  onack: (shownAt: string) => Promise<unknown>;
  oncopy: (text: string) => void;
  onexpand: () => void;
} = $props();

let overageOk = $state(false);
const est = $derived(estimates[effort] ?? null);
const main = $derived(est ? figures(est, true) : null);
const bill = $derived(est && main ? billingLine(est, main.usd, t) : null);
const mode = $derived(est ? startMode(est, engine, overageOk) : null);
const util = $derived(win?.fiveHour?.utilization ?? null);
const policyKey = $derived.by(() => {
  const k = engineStatus?.dataPolicyKey ? `policy.${engineStatus.dataPolicyKey.replace(/[^a-zA-Z0-9]/g, "_")}` : "";
  return k && hasKey(k) ? k : "policy.default";
});

// disclosure visibility (≥ 1 s in view before a click may acknowledge it)
let disclosure: HTMLElement | undefined = $state();
const clock = new VisibleClock();
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
const validity = $derived(est ? estimateValidity(est, Date.now()) : null);
const resetAt = $derived(win?.fiveHour?.resetsAt ?? null);
/** 「範囲を絞る」 on the card = the next smaller effort (its estimate is already fetched; switching costs 0 requests). */
const narrower = $derived(narrowerEffort(effort));
</script>

{#if collapsed}
  <button type="button" class="est one card" onclick={onexpand}>
    <span class="t">{t("gen.card.title")}</span>
    {#if est && main}<span class="mono">{t(`gen.effort.${effort}`)} {main.tokens} &middot; {main.usd}</span>{/if}
  </button>
{:else}
  <section class="est card" aria-labelledby="est-title" data-chrome>
    <h2 id="est-title">{t("gen.card.title")}</h2>

    <div class="eff" role="radiogroup" aria-label={t("gen.card.effortLabel")}>
      {#each EFFORTS as e (e)}
        {@const x = estimates[e]}
        {@const f = x ? figures(x, false) : null}
        <label class:sel={e === effort}>
          <input type="radio" name="mitori-effort" value={e} checked={e === effort} onchange={() => oneffort(e)} />
          <span class="tt">{t(`gen.effort.${e}`)}{#if e === "standard"}<span class="rec">{t("gen.card.recommended")}</span>{/if}</span>
          {#if f}
            <span class="v mono" title="{f.tokens} tok">{f.tokens} tok</span>
            <span class="v2" title="{f.usd} · {f.time}">{f.usd} &middot; {f.time}</span>
          {:else}
            <span class="v skel">&nbsp;</span><span class="v2 skel">&nbsp;</span>
          {/if}
        </label>
      {/each}
    </div>

    {#if !policyAcked}
      <p class="disc" class:nudge bind:this={disclosure} data-testid="disclosure">
        {t(policyKey, {
          files: scan ? scan.included.toLocaleString() : "–",
          excluded: scan ? (scan.files - scan.included).toLocaleString() : "–",
        })}
      </p>
    {/if}

    <div class="main">
      {#if est && main && mode}
        <p class="sum">
          <span class="lead">{t("gen.card.mainLine", { effort: t(`gen.effort.${effort}`), tokens: main.tokens, usd: main.usd, time: main.time })}{#if main.range}<span class="unc">{t("gen.card.uncalibrated")}</span>{/if}</span>
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
        <p class="sum"><span class="skel lead-skel">&nbsp;</span></p>
        <button type="button" class="btn btn-pri go" aria-disabled="true">{t("gen.card.start")}</button>
      {/if}
    </div>

    {#if mode?.kind === "overage"}
      <label class="ovg"><input type="checkbox" bind:checked={overageOk} /> {t("gen.card.overageAck")}</label>
    {/if}
    {#if est?.confirmReasons.includes("api_key_billing")}
      <p class="sub warn">{t("gen.card.apiKeyBilling", { usd: fmtUsdImpl(est.apiUsd, "gen") })}</p>
    {/if}
    {#if mode?.kind === "session"}
      <ol class="steps">
        <li>{t("gen.session.step1")}</li>
        <li>{t("gen.session.step2")}</li>
        <li>{t("gen.session.step3")}</li>
      </ol>
      <button type="button" class="btn btn-gh" onclick={() => oncopy(mode.raw)}><code>{mode.raw}</code></button>
    {/if}

    <p class="sub">
      {t("gen.card.supplement", {
        engine: engine,
        auth: t(`gen.card.auth.${engineStatus?.auth ?? "unknown"}`),
        c: est?.concurrency ?? "–",
        window: windowText,
      })}
    </p>

    {#if est}
      <details class="brk" open={breakdownOpen}>
        <summary>{t("gen.card.breakdown")}</summary>
        <table>
          <thead><tr><th scope="col">{t("gen.card.colStage")}</th><th scope="col">{t("gen.card.colIo")}</th><th scope="col">$</th><th scope="col">{t("gen.card.colTime")}</th></tr></thead>
          <tbody>
            {#each stageRows(est) as r (r.stage)}
              <tr><td>{t(`gen.stage.${r.stage}`)}{#if r.critical}*{/if} &middot; {r.tasks}</td><td class="mono">{r.io}</td><td class="mono">{r.usd}</td><td class="mono">{r.time}</td></tr>
            {/each}
          </tbody>
        </table>
        <p class="note">{t("gen.card.critical")}</p>
        <fieldset class="eng">
          <legend>{t("gen.card.engineLabel")}</legend>
          {#each est.alternatives as alt (alt.engine)}
            <label
              ><input type="radio" name="mitori-engine" value={alt.engine} checked={alt.engine === engine} onchange={() => onengine(alt.engine)} />
              <span class="mono">{alt.engine}</span>
              <span>{t("gen.card.alt", { c: alt.concurrency, usd: fmtUsdImpl(alt.apiUsd, "gen") })}{#if alt.sessionTokens}{t("gen.card.altSession", { k: fmtTokensImpl(alt.sessionTokens) })}{/if}{#if alt.uncalibrated}{t("gen.card.uncalibrated")}{/if}</span>
            </label>
          {/each}
        </fieldset>
        {#if validity}<p class="note mono">{t("gen.card.validity", { id: est.id.slice(3, 11), min: validity.minutes })}</p>{/if}
      </details>
    {/if}
  </section>
{/if}

<style>
  .est {
    padding: 18px 20px 12px;
    box-shadow: var(--shadow-soft);
    min-height: 352px;
  }
  .est.one {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    min-height: 48px;
    padding: 10px 16px;
    text-align: left;
  }
  .one .t {
    font-family: var(--font-serif);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  h2 {
    font-family: var(--font-serif);
    font-size: var(--fs-lead);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 12px;
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
    padding: 9px 10px 8px;
    cursor: pointer;
    min-height: 70px;
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
    font-size: var(--fs-label);
    color: var(--text);
    line-height: 1.5;
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
    gap: 12px;
    justify-content: space-between;
    padding: 12px 0 4px;
    min-height: 76px;
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
  .go {
    min-width: 104px;
    flex: none;
  }
  .four {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }
  .sub {
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.6;
    margin: 6px 0 4px;
    padding-top: 8px;
    border-top: 1px solid var(--rule-soft);
  }
  .sub.warn {
    color: var(--c-warn);
    border: 0;
    padding: 0;
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
  }
  .brk summary {
    cursor: pointer;
    color: var(--muted);
    min-height: 28px;
    display: flex;
    align-items: center;
  }
  .brk table {
    width: 100%;
    border-collapse: collapse;
    margin: 4px 0;
  }
  .brk th {
    text-align: left;
    font-weight: var(--fw-regular);
    color: var(--muted);
    border-bottom: 1px solid var(--rule);
    padding: 4px 4px 4px 0;
  }
  .brk td {
    padding: 4px 4px 4px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .note {
    color: var(--muted);
    margin: 4px 0;
  }
  .eng {
    border: 0;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .eng legend {
    color: var(--muted);
    padding: 0;
    margin-bottom: 4px;
  }
  .eng label {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 24px;
  }
</style>
