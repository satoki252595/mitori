<!--
  Status bar (24 px, mono 12 px, --muted on --paper-2; ux.md §3.4, contract `StatusBarProps`). Fixed-width
  segments so changing numbers never shift their neighbours (CLS 0). Billing wording per UXP-09.
-->
<script lang="ts">
import { useStores } from "../stores/app.svelte.ts";
import { fmtTokensImpl, fmtUsdImpl } from "./fmt.ts";
import { t } from "./index.ts";

const s = useStores();
const conn = $derived(s.session.connection);
const endpoint = $derived(typeof location === "undefined" ? "" : location.host);
const scan = $derived(s.workspace.status?.scan.summary ?? null);
const sched = $derived(s.session.scheduler);
const chip = $derived(s.review.chip);
const engine = $derived(s.session.engine(s.workspace.status?.genEngine ?? null));
const win = $derived(s.session.window ?? engine?.window ?? null);
const billing = $derived(win?.billing ?? engine?.billing ?? "unknown");
const overage = $derived(billing === "overage" || !!win?.overage?.active);
const today = $derived(s.session.today);
const billed = $derived(billing === "metered-api" || overage);
const pending = $derived(s.keys.pendingPrefix);
const ws = $derived(s.workspace.key);
// segments appear together once the first data arrived (or after 1.2 s): later updates only change numbers
let timedOut = $state(false);
$effect(() => {
  const h = setTimeout(() => (timedOut = true), 1200);
  return () => clearTimeout(h);
});
const ready = $derived(timedOut || (s.session.daemon !== null && s.session.today !== null && (!s.workspace.key || s.workspace.status !== null)));
</script>

<footer class="status" data-chrome aria-label={t("statusbar.label")}>
{#if ready}
  <span class="w-daemon" aria-label={t(`statusbar.conn.${conn.kind}`)}
    ><span class="live-dot" data-s={conn.kind} aria-hidden="true"></span>{t("statusbar.daemon", { endpoint })}</span
  >
  <span class="sb-sep" aria-hidden="true"></span>
  <button type="button" class="w-index" onclick={() => ws && void s.router.go({ name: "gen", ws })} aria-label={t("statusbar.indexAria")}>
    {#if scan}{t("statusbar.index", { files: scan.files.toLocaleString(), ms: Math.round(scan.ms) })}{:else if s.workspace.scan}{t("statusbar.scanning", { done: s.workspace.scan.done, total: s.workspace.scan.total })}{:else}{t("statusbar.indexNone")}{/if}
  </button>
  <span class="sb-sep w-jobs-sep" aria-hidden="true"></span>
  <span class="w-jobs"
    >{t("statusbar.jobs", {
      running: chip.running,
      queued: s.review.queued,
      c: sched ? (sched.effective < sched.concurrency ? `${sched.effective}/${sched.concurrency}` : String(sched.concurrency)) : "–",
    })}</span
  >
  <span class="sb-sep w-today-sep" aria-hidden="true"></span>
  <span class="w-today"
    >{today
      ? t(billed ? "statusbar.todayBilled" : "statusbar.today", { tok: fmtTokensImpl(today.in + today.cacheRead + today.cacheWrite + today.out), usd: fmtUsdImpl(today.apiUsd, "day") })
      : t("statusbar.todayNone")}</span
  >
  {#if win?.fiveHour}
    <span class="sb-sep w-win-sep" class:warn={overage} aria-hidden="true"></span>
    <span class="w-win" class:warn={overage}
      >{overage
        ? t("statusbar.windowOverage", { p: Math.round(win.fiveHour.utilization * 100) })
        : t("statusbar.window", { p: Math.round(win.fiveHour.utilization * 100), q: win.sevenDay ? Math.round(win.sevenDay.utilization * 100) : "–" })}</span
    >
  {/if}
  <span class="sb-sep w-engine-sep" aria-hidden="true"></span>
  <span class="w-engine">{engine ? t("statusbar.engine", { engine: engine.engine, auth: t(`statusbar.auth.${engine.auth}`) }) : t("statusbar.engineNone")}</span>
  <span class="grow"></span>
  {#if pending}<span class="w-pending" aria-live="polite">{pending} &hellip;</span>{/if}
  <button type="button" class="w-help" onclick={() => (s.ui.helpOpen = true)}>{t("statusbar.help")}</button>
{/if}
</footer>

<style>
  /* minimum widths sized for typical values: changing numbers do not move the next segment */
  .w-daemon {
    min-width: 200px;
  }
  .w-index {
    min-width: 220px;
  }
  .w-jobs {
    min-width: 226px;
  }
  .w-today {
    min-width: 300px;
  }
  .w-win {
    min-width: 136px;
  }
  .w-engine {
    min-width: 190px;
  }
  .w-help {
    color: var(--muted);
  }
  /* the sequence hint overlays the free space left of help: it never pushes a segment */
  .w-pending {
    position: absolute;
    right: 130px;
    top: 0;
    bottom: 0;
    background: var(--paper-2);
    color: var(--ink);
  }
  /*
   * Fixed segment widths sum to 1,422 px with every segment; segments drop in a fixed order as the bar narrows
   * (engine → 5h window unless it warns → jobs → today) so the bar never overflows (AC-U-W01) and a segment never
   * moves while its numbers change (CLS 0).
   */
  @container status (max-width: 1423px) {
    .w-engine,
    .w-engine-sep {
      display: none;
    }
  }
  @container status (max-width: 1231px) {
    .w-win:not(.warn),
    .w-win-sep:not(.warn) {
      display: none;
    }
  }
  @container status (max-width: 1095px) {
    .w-jobs,
    .w-jobs-sep {
      display: none;
    }
  }
  @container status (max-width: 867px) {
    .w-today,
    .w-today-sep {
      display: none;
    }
  }
</style>
