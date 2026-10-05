<!--
  Status bar (24 px, mono 12 px, --muted on --paper-2; ux.md §3.4, contract `StatusBarProps`). Fixed-width
  segments so changing numbers never shift their neighbours (CLS 0). Billing wording per UXP-09.
-->
<script lang="ts">
import { untrack } from "svelte";
import { useStores } from "../stores/app.svelte.ts";
import { authDisplayKind, fmtTokensImpl, fmtUsdImpl } from "./fmt.ts";
import { t } from "./index.ts";
import { replaceChrome } from "./native.ts";
import { markAfterPaint } from "./perf.ts";

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
// UXP-09: 「請求なし」 only when the window says so — an unknown billing state makes no claim either way
const todayKey = $derived(billed ? "statusbar.todayBilled" : billing === "subscription-window" ? "statusbar.today" : "statusbar.todayUnknown");
const pending = $derived(s.keys.pendingPrefix);
const ws = $derived(s.workspace.key);
// segments appear together once the first data arrived (or after 1.2 s): later updates only change numbers
let timedOut = $state(false);
$effect(() => {
  const h = setTimeout(() => (timedOut = true), 1200);
  return () => clearTimeout(h);
});
const ready = $derived(timedOut || (s.session.daemon !== null && s.session.today !== null && (!s.workspace.key || s.workspace.status !== null)));
$effect(() => {
  if (ready && scan) markAfterPaint("mitori:scan:summary", { ws: ws ?? "", files: scan.files });
});

let host: HTMLElement | undefined = $state();
const esc = (v: string | number) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function html(): string {
  if (!ready) return "";
  const e = esc;
  const sep = (cls = "", warn = false) => `<span class="sb-sep ${cls}${warn ? " warn" : ""}" aria-hidden="true"></span>`;
  const index = scan
    ? t("statusbar.index", { files: scan.files.toLocaleString(), ms: Math.round(scan.ms) })
    : s.workspace.scan
      ? t("statusbar.scanning", { done: s.workspace.scan.done, total: s.workspace.scan.total })
      : t("statusbar.indexNone");
  return `<span class="w-daemon" aria-label="${e(t(`statusbar.conn.${conn.kind}`))}"><span class="live-dot" data-s="${conn.kind}" aria-hidden="true"></span>${e(t("statusbar.daemon", { endpoint }))}</span>${sep()}<button type="button" class="w-index" data-act="index" aria-label="${e(t("statusbar.indexAria"))}">${e(index)}</button>${sep("w-jobs-sep")}<span class="w-jobs">${e(t("statusbar.jobs", { running: chip.running, queued: s.review.queued, c: sched ? (sched.effective < sched.concurrency ? `${sched.effective}/${sched.concurrency}` : String(sched.concurrency)) : "–" }))}</span>${sep("w-today-sep")}<span class="w-today">${e(today ? t(todayKey, { tok: fmtTokensImpl(today.in + today.cacheRead + today.cacheWrite + today.out), usd: fmtUsdImpl(today.apiUsd, "day") }) : t("statusbar.todayNone"))}</span>${win?.fiveHour ? `${sep("w-win-sep", overage)}<span class="w-win${overage ? " warn" : ""}">${e(overage ? t("statusbar.windowOverage", { p: Math.round(win.fiveHour.utilization * 100) }) : t("statusbar.window", { p: Math.round(win.fiveHour.utilization * 100), q: win.sevenDay ? Math.round(win.sevenDay.utilization * 100) : "–" }))}</span>` : ""}${sep("w-engine-sep")}<span class="w-engine">${e(engine ? t("statusbar.engine", { engine: engine.engine, auth: t(`statusbar.auth.${authDisplayKind(engine)}`) }) : t("statusbar.engineNone"))}</span><span class="grow"></span>${pending ? `<span class="w-pending" aria-live="polite">${e(pending)} &hellip;</span>` : ""}<button type="button" class="w-help" data-act="help">${e(t("statusbar.help"))}</button>`;
}
const initialHtml = untrack(() => html());
let last = "";
$effect(() => {
  const next = html();
  const el = host;
  if (!el || next === last) return;
  untrack(() => {
    replaceChrome(el, next);
    last = next;
  });
});
function click(ev: MouseEvent) {
  const act = (ev.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
  if (act === "help") s.ui.helpOpen = true;
  else if (act === "index" && ws) void s.router.go({ name: "gen", ws });
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (native controls delegate clicks) -->
<footer class="status" data-chrome aria-label={t("statusbar.label")} bind:this={host} onclick={click}>{@html initialHtml}</footer>

<style>:global(.status .w-daemon) {
    min-width: 200px;
  }:global(.status .w-index) {
    min-width: 220px;
  }:global(.status .w-jobs) {
    min-width: 226px;
  }:global(.status .w-today) {
    min-width: 300px;
  }:global(.status .w-win) {
    min-width: 136px;
  }:global(.status .w-engine) {
    min-width: 190px;
  }:global(.status .w-help) {
    color: var(--muted);
  }:global(.status .w-pending) {
    position: absolute;
    right: 130px;
    top: 0;
    bottom: 0;
    background: var(--paper-2);
    color: var(--ink);
  }

  @container status (max-width: 1423px) {:global(.status .w-engine),
:global(.status .w-engine-sep) {
      display: none;
    }
  }
  @container status (max-width: 1231px) {:global(.status .w-win:not(.warn)),
:global(.status .w-win-sep:not(.warn)) {
      display: none;
    }
  }
  @container status (max-width: 1095px) {:global(.status .w-jobs),
:global(.status .w-jobs-sep) {
      display: none;
    }
  }
  @container status (max-width: 867px) {:global(.status .w-today),
:global(.status .w-today-sep) {
      display: none;
    }
  }

  @container status (max-width: 1479px) {:global(:root[lang="en"] .status .w-engine) {

      display: block;
      flex: 0 1 auto;
      min-width: 0;
      line-height: 23px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  @container status (max-width: 1278px) {:global(:root[lang="en"] .status .w-win:not(.warn)),
:global(:root[lang="en"] .status .w-win-sep:not(.warn)) {
      display: none;
    }
  }
  @container status (max-width: 1141px) {:global(:root[lang="en"] .status .w-jobs),
:global(:root[lang="en"] .status .w-jobs-sep) {
      display: none;
    }
  }
  @container status (max-width: 896px) {:global(:root[lang="en"] .status .w-today),
:global(:root[lang="en"] .status .w-today-sep) {
      display: none;
    }
  }

</style>
