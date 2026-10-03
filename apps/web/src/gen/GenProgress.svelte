<!--
  Generation progress (ux.md §4.2.5, contract `GenProgressProps`, prototype `01c-generating`): replaces the
  estimate card in the same box. The run's main line (effort · estimate) with pause / cancel, the stage list
  (✓ done / ◐ running / ○ waiting, `n / total`, ×parallel, confirmed tokens per stage), one task-share bar and the
  live counters (confirmed usage only, never decreasing — AC-U23; no time-based %, no role="progressbar").
-->
<script lang="ts">
import type { GenRun, GenTaskView } from "@mitori/core";
import { fmtClock, fmtDurationImpl, fmtHm, fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { figures, totalTokens } from "./estimate.ts";
import { type Counters, elapsedMs, runCounters, runShare, stageRowsLive } from "./progress.ts";

let {
  run,
  tasks,
  tail,
  oncontrol,
}: { run: GenRun; tasks: readonly GenTaskView[]; tail: string | null; oncontrol: (a: "pause" | "resume" | "cancel") => void } = $props();

let prev: Counters | null = null;
const counters = $derived.by(() => {
  const c = runCounters(run, prev);
  prev = c;
  return c;
});
let now = $state(Date.now());
$effect(() => {
  if (run.state !== "running") return;
  const h = setInterval(() => (now = Date.now()), 1000);
  return () => clearInterval(h);
});
const rows = $derived(stageRowsLive(run, tasks));
const est = $derived(run.estimate);
const main = $derived(figures(est, true));
const share = $derived(runShare(run));
const paused = $derived(run.state === "paused" ? (run.paused ?? { reason: "user" as const }) : null);
const GLYPH = { done: "✓", running: "◐", waiting: "○", failed: "✕" } as const;
</script>

<section class="prog card" aria-labelledby="prog-t" data-chrome>
  <h2 id="prog-t">{t("gen.progress.title")}</h2>
  <div class="head">
    <p class="lead">{t("gen.card.mainLine", { effort: t(`gen.effort.${run.effort}`), tokens: main.tokens, usd: main.usd, time: main.time })}</p>
    <div class="ctl">
      {#if run.state === "paused"}
        <button type="button" class="btn btn-sec btn-s" onclick={() => oncontrol("resume")}>{t("gen.progress.resume")}</button>
      {:else}
        <button type="button" class="btn btn-sec btn-s" onclick={() => oncontrol("pause")}>{t("gen.progress.pause")}</button>
      {/if}
      <button type="button" class="btn btn-gh btn-s" onclick={() => oncontrol("cancel")}>{t("gen.progress.cancel")}</button>
    </div>
  </div>

  <ul class="stages">
    {#each rows as r (r.stage)}
      <li data-s={r.status}>
        <span class="g" aria-hidden="true">{GLYPH[r.status]}</span>
        <span class="lbl"
          >{t(`gen.progress.row.${r.stage}`)}
          {#if r.total > 1}<span class="n mono">{r.done} / {r.total}</span>{/if}
          {#if r.running > 1}<span class="par">{t("gen.progress.parallel", { n: r.running })}</span>{/if}
          <span class="sr-only">{t(`gen.progress.state.${r.status}`)}</span></span
        >
        <span class="tok mono">{r.used > 0 ? fmtTokensImpl(r.used) : r.planned > 0 ? `≈${fmtTokensImpl(r.planned)}` : ""}</span>
      </li>
    {/each}
  </ul>

  <div class="bar" aria-hidden="true"><i style:transform="scaleX({share})"></i></div>
  <p class="foot mono">
    <span>{fmtTokensImpl(counters.inTokens + counters.outTokens)} / {fmtTokensImpl(totalTokens(est), { main: true })} tok</span>
    <span>{fmtClock(elapsedMs(run, now))} / {fmtDurationImpl(est.seconds.p50 * 1000, "gen")}</span>
  </p>
  <dl class="cnt mono">
    <div><dt>{t("gen.progress.in")}</dt><dd>{fmtTokensImpl(counters.inTokens)}</dd></div>
    <div><dt>{t("gen.progress.out")}</dt><dd>{fmtTokensImpl(counters.outTokens)}</dd></div>
    <div><dt>{t("gen.progress.usd")}</dt><dd>{fmtUsdImpl(counters.usd, "gen")} <span>/ &asymp;{fmtUsdImpl(est.apiUsd, "gen")}</span></dd></div>
    <div><dt>{t("gen.progress.blocks")}</dt><dd>{run.progress.blocks}</dd></div>
  </dl>
  {#if paused}
    <p class="paused" role="status">{t(`gen.progress.paused.${paused.reason}`, { at: paused.until ? fmtHm(paused.until) : "–" })}</p>
  {/if}
  <p class="tail mono">{tail ?? " "}</p>
</section>

<style>
  .prog {
    padding: 22px 24px 14px;
    box-shadow: var(--shadow-soft);
    min-height: 352px;
  }
  h2 {
    font-family: var(--font-serif);
    font-size: 21px;
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 12px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule-soft);
  }
  .lead {
    margin: 0;
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    min-width: 0;
  }
  .ctl {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .stages {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .stages li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 8px;
    min-height: 30px;
    padding: 4px 0;
    font-size: var(--fs-ui);
    color: var(--muted);
  }
  .stages li[data-s="running"] {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .stages li[data-s="done"] .g {
    color: var(--c-ok);
  }
  .stages li[data-s="running"] .g {
    color: var(--gen-ring);
  }
  .stages li[data-s="failed"] .g {
    color: var(--c-bad);
  }
  .g {
    text-align: center;
    font-size: var(--fs-ui-m);
  }
  .lbl {
    min-width: 0;
  }
  .n {
    margin-left: 6px;
    font-size: var(--fs-label);
  }
  .par {
    margin-left: 4px;
    font-size: var(--fs-label);
    font-weight: var(--fw-regular);
    color: var(--muted);
  }
  .tok {
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .bar {
    height: 3px;
    margin: 10px 0 0;
    border-radius: 2px;
    background: var(--rule);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--ink);
    transform-origin: 0 50%;
    transition: transform 0.4s var(--ease-out);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .cnt {
    display: grid;
    grid-template-columns: repeat(4, auto);
    justify-content: space-between;
    gap: 8px;
    margin: 12px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--rule-soft);
  }
  dt {
    font-family: var(--font-ui);
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--ink);
    white-space: nowrap;
  }
  dd span {
    color: var(--muted);
  }
  .paused {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--c-warn);
  }
  .tail {
    margin: 6px 0 0;
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
