<!--
  Generation progress (ux.md §4.2.5, contract `GenProgressProps`): replaces the estimate card in the same box.
  Counters use confirmed usage only and never decrease; stage rows show done / total (the thin meter draws that
  ratio — no time-based %, no role="progressbar", AC-U23); pause / resume / cancel any time.
-->
<script lang="ts">
import type { GenRun, GenTaskView } from "@mitori/core";
import { fmtClock, fmtDurationImpl, fmtHm, fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { totalTokens } from "./estimate.ts";
import { type Counters, elapsedMs, runCounters, stageProgress } from "./progress.ts";

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
const stages = $derived(stageProgress(tasks));
const est = $derived(run.estimate);
const paused = $derived(run.state === "paused" ? (run.paused ?? { reason: "user" as const }) : null);
</script>

<section class="prog card" aria-labelledby="prog-t" data-chrome>
  <h2 id="prog-t">{t("gen.progress.title")}</h2>
  <dl class="cnt">
    <div><dt>{t("gen.progress.in")}</dt><dd class="mono">{fmtTokensImpl(counters.inTokens)} <span>/ {fmtTokensImpl(est.inTokens + est.cacheReadTokens + est.cacheWriteTokens, { approx: true })}</span></dd></div>
    <div><dt>{t("gen.progress.out")}</dt><dd class="mono">{fmtTokensImpl(counters.outTokens)}</dd></div>
    <div><dt>{t("gen.progress.usd")}</dt><dd class="mono">{fmtUsdImpl(counters.usd, "gen")} <span>/ &asymp;{fmtUsdImpl(est.apiUsd, "gen")}</span></dd></div>
    <div><dt>{t("gen.progress.elapsed")}</dt><dd class="mono">{fmtClock(elapsedMs(run, now))} <span>/ {fmtDurationImpl(est.seconds.p50 * 1000, "gen")}</span></dd></div>
  </dl>
  <ul class="stages">
    {#each stages as st (st.stage)}
      <li class:on={st.running > 0}>
        <span class="lbl">{t(`gen.stage.${st.stage}`)}{#if st.running > 1}<span class="mono"> &times;{st.running}</span>{/if}</span>
        <span class="mono n">{st.done} / {st.total}</span>
        <span class="meter" aria-hidden="true"><i style:transform="scaleX({st.total ? st.done / st.total : 0})"></i></span>
      </li>
    {/each}
  </ul>
  {#if paused}
    <p class="paused" role="status">{t(`gen.progress.paused.${paused.reason}`, { at: paused.until ? fmtHm(paused.until) : "–" })}</p>
  {/if}
  <p class="tail mono">{tail ?? " "}</p>
  <div class="ctl">
    {#if run.state === "paused"}
      <button type="button" class="btn btn-sec btn-s" onclick={() => oncontrol("resume")}>{t("gen.progress.resume")}</button>
    {:else}
      <button type="button" class="btn btn-sec btn-s" onclick={() => oncontrol("pause")}>{t("gen.progress.pause")}</button>
    {/if}
    <button type="button" class="btn btn-gh btn-s" onclick={() => oncontrol("cancel")}>{t("gen.progress.cancel")}</button>
    <span class="tot mono">{t("gen.progress.estimate", { tok: fmtTokensImpl(totalTokens(est), { approx: true }) })}</span>
  </div>
</section>

<style>
  .prog {
    padding: 18px 20px 12px;
    box-shadow: var(--shadow-soft);
    min-height: 352px;
  }
  h2 {
    font-family: var(--font-serif);
    font-size: var(--fs-lead);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 12px;
  }
  .cnt {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    border: 1px solid var(--rule);
    border-radius: 8px;
    margin: 0;
    overflow: hidden;
  }
  .cnt div {
    padding: 8px 10px;
  }
  .cnt div:nth-child(even) {
    border-left: 1px solid var(--rule);
  }
  .cnt div:nth-child(n + 3) {
    border-top: 1px solid var(--rule);
  }
  dt {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-size: var(--fs-ui);
    color: var(--ink);
  }
  dd span {
    color: var(--muted);
    font-size: var(--fs-label);
  }
  .stages {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .stages li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .stages li.on {
    color: var(--ink);
  }
  .meter {
    grid-column: 1 / -1;
    height: 3px;
    border-radius: 2px;
    background: var(--rule);
    overflow: hidden;
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--ink);
    transform-origin: 0 50%;
    transition: transform 0.4s var(--ease-out);
  }
  .paused {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--c-warn);
  }
  .tail {
    margin: 8px 0 0;
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
  .tot {
    margin-left: auto;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
</style>
