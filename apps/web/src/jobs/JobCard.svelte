<!--
  Job card (contract `JobCardProps`, ux.md §6.4, JUDGEMENT §6.6, prototype 03c): the planned stages of the route
  from the first frame (✓ only as real `JobEvent`s arrive — no % bar, no invented time left, WEB-U-032), the tail
  line, the streamed answer in answer mode, and 「{経過}秒 · 通常 {p25}–{p75}秒 · 読み続けて大丈夫です［中止］」.
  Also the confirm form (`requiresConfirm`: ≈k tok · reasons ［実行 ⌘⏎］［範囲を絞る］［プロンプトをコピー］), the
  send-failed form and the failure detail (cause chain, stderr tail, next actions, AC-J39).
-->
<script lang="ts">
import type { ConfirmReason, JobEstimate, JobSummary, ThreadIntent } from "@mitori/core";
import { onMount } from "svelte";
import type { StageRow } from "../contract.ts";
import { copyText } from "../shell/clipboard.ts";
import { fmtTokens, fmtUsd, isComposing, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import StatusPill from "../threads/StatusPill.svelte";
import { jobStatus } from "./index.ts";

let {
  job,
  rows,
  tail,
  elapsedMs,
  usual,
  answer,
  oncancel,
  intent,
  quote,
  body,
  acceptMs = null,
  form = "run",
  estimate = null,
  error = null,
  showIds = false,
  round = 1,
  onconfirm = () => {},
  onnarrow = () => {},
  oncopy = () => {},
  onretry = () => {},
}: {
  job: JobSummary;
  rows: readonly StageRow[];
  tail: string | null;
  elapsedMs: number;
  usual: { lo: number; hi: number; n: number } | null;
  answer: string;
  oncancel: () => void;
  intent: ThreadIntent;
  quote: string;
  body: string;
  acceptMs?: number | null;
  form?: "run" | "confirm" | "error";
  estimate?: JobEstimate | null;
  error?: string | null;
  showIds?: boolean;
  round?: number;
  onconfirm?: () => void;
  onnarrow?: () => void;
  oncopy?: () => void;
  onretry?: () => void;
} = $props();

const s = useStores();
const status = $derived(jobStatus(job.state));
const running = $derived(["queued", "waiting_lock", "preparing", "running", "gating", "repairing"].includes(job.state));
const failed = $derived(job.state === "failed");
let expanded = $state<string | null>(null);
let showFail = $state(false);
let cardEl: HTMLElement | undefined = $state();

function rowName(r: StageRow): string {
  if (r.key === "spawn") return t("jobs.stage.spawnModel", { model: job.route.model });
  if (r.key === "think" && r.state === "now") return t("jobs.stage.thinkNow");
  if (r.key === "gate") return r.detail ?? r.gate ?? t("stage.gate");
  return t(`stage.${r.key}`);
}

function rowDetail(r: StageRow): string | null {
  if (r.key === "accept") return acceptMs !== null ? t("jobs.detail.accept", { ms: acceptMs }) : t("jobs.detail.acceptSending");
  if (r.key === "gate") {
    if (r.state === "skipped") return t("jobs.detail.gateSkipped");
    if (r.state === "failed") return t("jobs.detail.gateFailed");
    if (r.state === "done" && r.atMs !== undefined) return t("jobs.detail.gatePass");
    return r.gate ?? null;
  }
  if (r.key === "bundle" && !r.detail && estimate)
    return `MBF/1 · ${fmtTokens(estimate.bundle.tokens)} tok · router → ${estimate.route.mode}（${estimate.route.reason}）`;
  return r.detail ?? null;
}

const reasons = $derived((estimate?.estimate.confirmReasons ?? []).map((r: ConfirmReason) => t(`jobs.confirm.reason.${r}`)).join(t("jobs.confirm.sep")));
const totalTok = $derived(
  estimate ? estimate.estimate.inTokens + estimate.estimate.cacheReadTokens + estimate.estimate.cacheWriteTokens + estimate.estimate.outTokens : 0,
);

// the confirm form accepts ⌘⏎ while focus is inside the card (the read scope has no ⌘⏎)
function onKey(e: KeyboardEvent) {
  if (isComposing(e)) return;
  if (form === "confirm" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    onconfirm();
  }
}

onMount(() => {
  if (form === "confirm") cardEl?.querySelector<HTMLButtonElement>("button.run")?.focus({ preventScroll: true });
});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (⌘⏎ confirms while focus is inside; the buttons are the primary path) -->
<article class="card jc" class:failed bind:this={cardEl} onkeydown={onKey} aria-label={t("jobs.card.label", { intent: t(`composer.intent.${intent}`) })} data-chrome>
  <header class="jc-h">
    <span class="who"><b>{t(`composer.intent.${intent}`)}</b><span class="arrow">{t("jobs.card.you2ai")}</span></span>
    {#if showIds}<span class="mono id">{job.threads[0] ?? ""} · R{round}</span>{/if}
    <span class="pill" aria-live="polite"><StatusPill {status} /></span>
  </header>
  {#if quote}<p class="q" data-user-content>{quote}</p>{/if}
  {#if body}<p class="b" data-user-content>{body}</p>{/if}

  {#if form === "confirm" && estimate}
    <div class="confirm" role="group" aria-label={t("jobs.confirm.label")}>
      <p>{t("jobs.confirm.text", { k: fmtTokens(totalTok, { approx: true }), usd: fmtUsd(estimate.estimate.apiUsd, "job"), reasons })}</p>
      <div class="row">
        <button type="button" class="btn btn-pri btn-s run" onclick={onconfirm}>{t("jobs.confirm.run")}<kbd>{s.keys.label("Mod+Enter")}</kbd></button>
        <button type="button" class="btn btn-sec btn-s" onclick={onnarrow}>{t("jobs.confirm.narrow")}</button>
        <button type="button" class="btn btn-gh" onclick={oncopy}>{t("jobs.confirm.copy")}</button>
      </div>
    </div>
  {:else if form === "error"}
    <div class="confirm bad" role="alert">
      <p>{t("jobs.error.send")}{#if error}<span class="e"> — {error}</span>{/if}</p>
      <p class="keep">{t("jobs.fail.kept")}</p>
      <div class="row"><button type="button" class="btn btn-sec btn-s" onclick={onretry}>{t("jobs.error.retry")}</button></div>
    </div>
  {:else}
    {#if job.state === "waiting_lock"}<p class="lock">{t("jobs.lock")}</p>{/if}
    <ol class="stages">
      {#each rows as r, i (`${r.key}:${r.gate ?? ""}:${i}`)}
        {@const d = rowDetail(r)}
        <li class="st" data-state={r.state}>
          <span class="dot" aria-hidden="true"></span>
          <span class="nm">{rowName(r)}<span class="sr-only"> · {t(`jobs.rowState.${r.state}`)}</span></span>
          <span class="at mono">{r.atMs !== undefined ? `${(r.atMs / 1000).toFixed(1)}s` : r.state === "now" ? `${(elapsedMs / 1000).toFixed(1)}s` : ""}</span>
          {#if d}
            {#if r.key === "spawn"}
              <button type="button" class="dt mono spawn" aria-expanded={expanded === `${i}`} onclick={() => (expanded = expanded === `${i}` ? null : `${i}`)}>{d}</button>
              {#if expanded === `${i}`}
                <div class="argv"><pre class="mono">{d}</pre><button type="button" class="btn btn-gh" onclick={() => void copyText(d, s, "copy.command")}>{t("jobs.copyArgv")}</button></div>
              {/if}
            {:else}
              <span class="dt mono">{d}</span>
            {/if}
          {/if}
        </li>
      {/each}
    </ol>
    {#if tail && running}<p class="tail mono" aria-hidden="true">{tail}</p>{/if}
    {#if answer}
      <div class="answer" data-user-content>{answer}{#if running}<span class="caret" aria-hidden="true"></span>{/if}</div>
    {/if}
    {#if failed && job.failure}
      <div class="fail">
        <p class="fm">{t(`error.${job.failure.code}`)}{#if job.escalatedFrom}<span class="chain"> · {t("jobs.fail.escalated")}</span>{/if}</p>
        <button type="button" class="link" aria-expanded={showFail} onclick={() => (showFail = !showFail)}>{showFail ? t("jobs.fail.less") : t("jobs.fail.more")}</button>
        {#if showFail}
          {#if job.failure.stderrTail?.length}<pre class="stderr mono">{job.failure.stderrTail.join("\n")}</pre>{/if}
          <p class="cost mono">{t("jobs.fail.cost", { usd: fmtUsd(job.usage?.apiUsd ?? 0, "job"), n: job.attempt })}</p>
        {/if}
        <p class="keep">{t("jobs.fail.kept")}</p>
      </div>
    {/if}
    <footer class="jc-f">
      {#if running}
        <span class="mono">{t("jobs.elapsed", { s: (elapsedMs / 1000).toFixed(1) })}</span>
        {#if usual}<span>{t("jobs.usual", { lo: usual.lo, hi: usual.hi })}</span>{#if usual.n > 0}<span class="n">{t("jobs.usualN", { n: usual.n })}</span>{/if}{/if}
        <span class="ok">{t("jobs.keepReading")}</span>
        <span class="grow"></span>
        <button type="button" class="btn btn-gh" onclick={oncancel}>{t("jobs.cancel")}</button>
      {:else if job.usage}
        <span class="mono">{fmtUsd(job.usage.apiUsd, "job")} · {t("jobs.took", { s: (elapsedMs / 1000).toFixed(1) })}</span>
      {/if}
    </footer>
  {/if}
</article>

<style>
  .jc {
    padding: 14px 16px 10px;
    box-shadow: var(--shadow-soft);
    font-size: var(--fs-ui);
  }
  .jc-h {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .jc-h .who b {
    color: var(--ink);
    font-weight: var(--fw-strong);
    margin-right: 8px;
  }
  .jc-h .id {
    font-size: var(--fs-meta);
  }
  .jc-h .pill {
    margin-left: auto;
  }
  .q {
    margin: 8px 0 0;
    padding-left: 10px;
    border-left: 2px solid var(--mark);
    color: var(--muted);
    font-size: var(--fs-label);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .b {
    margin: 8px 0 0;
    color: var(--ink);
    white-space: pre-wrap;
    line-height: 1.7;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .lock {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--c-warn);
  }
  .stages {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }
  .st {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    column-gap: 8px;
    align-items: baseline;
    padding: 3px 0;
  }
  .st .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--rule-2);
    align-self: center;
    justify-self: center;
  }
  .st[data-state="done"] .dot {
    background: var(--c-ok);
    border-color: var(--c-ok);
  }
  .st[data-state="now"] .dot {
    border-color: var(--c-run);
    border-right-color: transparent;
    animation: spin 0.9s linear infinite;
  }
  .st[data-state="failed"] .dot {
    border: 0;
    border-radius: 0;
    background: none;
    position: relative;
  }
  .st[data-state="failed"] .dot::before {
    content: var(--glyph-x);
    position: absolute;
    inset: -4px -2px;
    color: var(--c-bad);
    font-size: var(--fs-label);
    line-height: 1;
  }
  .st[data-state="skipped"] .dot {
    border: 0;
    border-top: 1.5px solid var(--muted);
    border-radius: 0;
    height: 0;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .st[data-state="planned"] .nm,
  .st[data-state="skipped"] .nm {
    color: var(--muted);
  }
  .st .nm {
    color: var(--ink);
    font-size: var(--fs-ui);
  }
  .st .at {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .st .dt {
    grid-column: 2 / 4;
    font-size: var(--fs-meta);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .st .dt.spawn:hover {
    color: var(--ink);
  }
  .argv {
    grid-column: 2 / 4;
    margin: 4px 0;
    padding: 6px 8px;
    border-radius: var(--r-chip);
    background: var(--paper-2);
  }
  .argv pre {
    margin: 0 0 4px;
    white-space: pre-wrap;
    word-break: break-all;
    font-size: var(--fs-meta);
  }
  .tail {
    margin: 10px 0 0;
    padding: 8px 10px;
    min-height: 2.6em;
    border-radius: var(--r-input);
    background: var(--paper);
    font-size: var(--fs-meta);
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .answer {
    margin: 10px 0 0;
    white-space: pre-wrap;
    line-height: 1.75;
    color: var(--ink);
  }
  .caret {
    display: inline-block;
    width: 2px;
    height: 1em;
    margin-left: 1px;
    vertical-align: -2px;
    background: var(--c-run);
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .confirm {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: var(--r-input);
    background: var(--c-warn-bg);
    font-size: var(--fs-label);
  }
  .confirm.bad {
    background: var(--c-bad-bg);
  }
  .confirm p {
    margin: 0 0 8px;
  }
  .confirm .e {
    color: var(--muted);
  }
  .confirm .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .confirm kbd {
    margin-left: 6px;
    background: none;
    color: inherit;
    border-color: color-mix(in srgb, var(--paper) 35%, transparent);
  }
  .keep {
    color: var(--muted);
    font-size: var(--fs-meta);
    margin: 4px 0 0;
  }
  .fail {
    margin-top: 10px;
    font-size: var(--fs-label);
  }
  .fail .fm {
    margin: 0 0 4px;
    color: var(--c-bad);
  }
  .fail .chain {
    color: var(--muted);
  }
  .stderr {
    margin: 6px 0;
    padding: 6px 8px;
    border-radius: var(--r-chip);
    background: var(--paper-2);
    font-size: var(--fs-meta);
    white-space: pre-wrap;
  }
  .cost {
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .jc-f {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: var(--fs-label);
    color: var(--muted);
    flex-wrap: wrap;
  }
  .jc-f .n,
  .jc-f .ok {
    font-size: var(--fs-meta);
  }
  .jc-f .grow {
    flex: 1;
  }
</style>
