<!--
  Ready card (contract `ReadyCardProps`, ux.md §6.5 / §4.7 R1, JUDGEMENT §6.7, prototype 03d): 「◆ レビュー待ち · +a −d ·
  n files · h hunk · 設計書 n ブロック · ✓ ゲート p/t · $ · s」 ［レビュー R］［採用 ⌘⏎］［却下 ⌘⌫］. ✓ only when every
  gate passed on the applied tree; unchecked gates say 「⚠ 検査なし（未承認 n 件）［内容を見て承認］」 (AC-U-G01);
  gates waiting for consent offer 「自動検査を実行」 (SEC-03); sensitive jobs have no accept button (SEC-12).
-->
<script lang="ts">
import type { GateResult, JobSummary, ThreadIntent } from "@mitori/core";
import { fmtUsd, isComposing, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import StatusPill from "../threads/StatusPill.svelte";
import { acceptNeedsWarning, gateBadge } from "./gates.ts";

let {
  job,
  hunks,
  gates,
  onreview,
  onaccept,
  onreject,
  intent,
  quote,
  body,
  accepting = false,
  onapprove = () => {},
  onrungates = () => {},
}: {
  job: JobSummary;
  hunks: number;
  gates: readonly GateResult[];
  onreview: () => void;
  onaccept: () => void;
  onreject: () => void;
  intent: ThreadIntent;
  quote: string;
  body: string;
  accepting?: boolean;
  onapprove?: () => void;
  onrungates?: () => void;
} = $props();

const s = useStores();
const badge = $derived(gateBadge({ gates, gateVerdict: job.gateVerdict }));
const warn = $derived(acceptNeedsWarning({ gates, gateVerdict: job.gateVerdict }));
const ds = $derived(job.diffStat);
const secs = $derived(job.timings ? (job.timings.wallMs / 1000).toFixed(1) : null);

function onKey(e: KeyboardEvent) {
  if (isComposing(e)) return;
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === "Enter" && !job.sensitive) {
    e.preventDefault();
    onaccept();
  } else if (e.key === "Backspace") {
    e.preventDefault();
    onreject();
  }
}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (⌘⏎ / ⌘⌫ while focus is inside; buttons are the primary path) -->
<article class="card rc" onkeydown={onKey} aria-label={t("jobs.ready.label")} data-chrome>
  <header class="rc-h">
    <span class="who"><b>{t(`composer.intent.${intent}`)}</b><span>{t("jobs.card.you2ai")}</span></span>
    <span class="pill"><StatusPill status="ready" /></span>
  </header>
  {#if quote}<p class="q" data-user-content>{quote}</p>{/if}
  {#if body}<p class="b" data-user-content>{body}</p>{/if}
  <div class="facts">
    {#if ds}
      <span class="fact mono"><span class="ad">+{ds.additions}</span> <span class="de">−{ds.deletions}</span> · {t("jobs.ready.files", { n: ds.files })} · {t("jobs.ready.hunks", { n: hunks })}</span>
    {/if}
    {#if job.proposals.length > 0}<span class="fact">{t("jobs.ready.blocks", { n: job.proposals.length })}</span>{/if}
    {#if badge.kind === "passed"}
      <span class="fact ok">✓ {t("jobs.ready.gates", { p: badge.pass, n: badge.total })}</span>
    {:else if badge.kind === "failed"}
      <span class="fact bad">✕ {t("jobs.ready.gates", { p: badge.pass, n: badge.total })}</span>
    {:else if badge.kind === "rechecking"}
      <span class="fact">{t("jobs.ready.rechecking")}</span>
    {:else if badge.kind === "unverified"}
      <span class="fact warn">⚠ {t("jobs.ready.unverified", { n: badge.unchecked + badge.pending })}</span>
    {/if}
    {#if job.usage}<span class="fact mono">{fmtUsd(job.usage.apiUsd, "job")}{#if secs} · {t("jobs.took", { s: secs })}{/if}</span>{/if}
  </div>
  {#if badge.kind === "unverified"}
    <p class="gate-act">
      {#if badge.unchecked > 0}<button type="button" class="link" onclick={onapprove}>{t("jobs.ready.approve")}</button>{/if}
      {#if badge.pending > 0}<button type="button" class="btn btn-sec btn-s" onclick={onrungates}>{t("jobs.ready.runGates")}</button>{/if}
    </p>
  {/if}
  {#if job.sensitive}<p class="sens">{t("jobs.ready.sensitive")}</p>{/if}
  <footer class="rc-f">
    <button type="button" class="btn btn-pri btn-s" onclick={onreview}>{t("jobs.ready.review")}<kbd>R</kbd></button>
    {#if !job.sensitive}
      <button type="button" class="btn btn-sec btn-s acc" class:warn={warn !== "none"} disabled={accepting} onclick={onaccept}>
        <span class="lbl" class:hid={accepting}>{warn === "failed" ? t("review.acceptFailed") : warn === "unverified" ? t("review.acceptUnverified") : t("jobs.ready.accept")}</span>
        <span class="lbl" class:hid={!accepting}>{t("review.accepting")}</span>
      </button>
    {/if}
    <button type="button" class="btn btn-gh" onclick={onreject}>{t("jobs.ready.reject")}</button>
    <span class="grow"></span>
    {#if !job.sensitive}<span class="hint">{t("jobs.ready.acceptHint", { k: s.keys.label("Mod+Enter") })}</span>{/if}
  </footer>
</article>

<style>
  .rc {
    padding: 14px 16px 12px;
    box-shadow: var(--shadow-soft);
    font-size: var(--fs-ui);
  }
  .rc-h {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .rc-h .who b {
    color: var(--ink);
    font-weight: var(--fw-strong);
    margin-right: 8px;
  }
  .rc-h .pill {
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
    line-height: 1.7;
    white-space: pre-wrap;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .fact {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 9px;
    border-radius: var(--r-chip-l);
    background: var(--paper-2);
    font-size: var(--fs-label);
    color: var(--text);
  }
  .fact.mono {
    font-size: var(--fs-meta);
  }
  .fact .ad {
    color: var(--add-fg);
  }
  .fact .de {
    color: var(--del-fg);
  }
  .fact.ok {
    background: var(--c-ok-bg);
    color: var(--c-ok);
  }
  .fact.bad {
    background: var(--c-bad-bg);
    color: var(--c-bad);
  }
  .fact.warn {
    background: var(--c-warn-bg);
    color: var(--c-warn);
  }
  .gate-act {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 8px 0 0;
    font-size: var(--fs-label);
  }
  .sens {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--c-warn);
  }
  .rc-f {
    display: flex;
    flex-wrap: wrap; /* the warning label of the accept button is long: the hint goes to the next line instead of being squeezed to one letter per row */
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }
  .rc-f kbd {
    margin-left: 6px;
    background: none;
    color: inherit;
    border-color: color-mix(in srgb, var(--paper) 35%, transparent);
  }
  .rc-f .grow {
    flex: 1;
  }
  .rc-f .hint {
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
  }
  .acc {
    display: inline-grid;
  }
  .acc .lbl {
    grid-area: 1 / 1;
  }
  .acc .lbl.hid {
    visibility: hidden;
  }
  .acc.warn {
    border-color: var(--c-warn);
    color: var(--c-warn);
  }
</style>
