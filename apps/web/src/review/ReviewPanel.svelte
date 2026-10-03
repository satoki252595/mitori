<!--
  Review panel (contract `UiExtension.reviewPanel` / `ReviewPanelProps`, ux.md §4.7 R1, JUDGEMENT §6.7, prototype 03e):
  sticky header (`th · R{n} · {mode} mode · tools …`, title, quote + ask, i/total, 閉じる Esc), gate pills (✓ only on a
  verified tree, AC-U-G01/G02), the actuals line, the AI summary (≤ 4 items + 「空白だけの変更 n 行」), the code diff and
  the doc proposals, and the sticky footer. Focus-unit decisions (⌘⏎ / ⌘⌫ / n / ⇧N / ⌥⌘⏎ / ⇧R / [ ]) are the `review`
  scope, which wins over `read` in `docReview` regardless of focus (AC-U-RS). Sensitive jobs: no one-key accept (SEC-12).
-->
<script lang="ts">
import { type JobDetail, type JobId, MitoriError } from "@mitori/core";
import { onMount } from "svelte";
import { acceptNeedsWarning, autofixedLines, gateBadge, gateLabel } from "../jobs/gates.ts";
import { errorText, fmtDelta, fmtTokens, fmtUsd, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { loopOf } from "../threads/loop.svelte.ts";
import ServerHtml from "../threads/ServerHtml.svelte";
import DiffView from "./DiffView.svelte";
import { acceptAll, clear, decide, focusedUnit, outcome, step, type Unit, unitsOf } from "./decisions.ts";

let { job }: { job: JobId } = $props();
const s = useStores();
const loop = loopOf(s);
let detail = $state.raw<JobDetail | null>(null);
let error = $state<string | null>(null);
let view = $state<"unified" | "split">("unified");
let rechecking = $state(false);
const summary = $derived(s.review.jobs.get(job) ?? detail);
const d = $derived(s.review.decisions(job));
const units = $derived(
  detail
    ? unitsOf(
        detail.diff,
        detail.proposalViews.map((p) => p.id),
      )
    : [],
);
const th = $derived(summary?.threads[0] ? s.review.threads.get(summary.threads[0]) : undefined);
const ready = $derived(loop.readyJobs());
const position = $derived({
  index: Math.max(
    0,
    ready.findIndex((j) => j.id === job),
  ),
  total: ready.length,
});
const wide = $derived(s.ctx.wide);
const tick = $derived(loop.decisionTick);
const sensitive = $derived(!!summary?.sensitive);
const warn = $derived(summary ? acceptNeedsWarning(summary) : "none");
const out = $derived.by(() => {
  void tick;
  return outcome(d, units, { sensitive, unverified: warn !== "none" });
});
const focused = $derived.by(() => {
  void tick;
  return focusedUnit(d, units);
});
const hunkDecisions = $derived.by(() => {
  void tick;
  return new Map(d.hunks);
});
const badge = $derived(summary ? gateBadge(summary) : { kind: "none" as const });
const resolvedElsewhere = $derived(!!summary && !["ready", "accepting", "partially_accepted"].includes(summary.state));
const accepting = $derived(loop.accepting.has(job));

async function load() {
  error = null;
  try {
    const v = await s.review.jobDetail(job);
    detail = v;
  } catch (err) {
    error = errorText(MitoriError.from(err).toData());
  }
}

$effect(() => {
  void job;
  void load();
});
// a state change of this job (gates re-run, partial accept) refreshes the detail
let lastState: string | null = null;
$effect(() => {
  const st = s.review.jobs.get(job)?.state ?? null;
  if (lastState !== null && st !== lastState) void load();
  lastState = st;
});

// ---------------------------------------------------------------- summary lines
const resultSummary = $derived.by(() => {
  const r = detail?.events.findLast((e) => e.t === "result");
  const st = r && r.t === "result" ? (r.structured as { summary?: string } | undefined) : undefined;
  const text = st?.summary ?? "";
  const items = text
    .split(/\n+|(?<=。)\s*/u)
    .map((x) => x.replace(/^[-*・]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
  return items;
});
const fmtLines = $derived(detail ? autofixedLines(detail.gates) : 0);
const doneMsg = $derived.by(() => {
  const m = th ? loop.messages.get(th.id) : undefined;
  return m?.findLast((x) => x.job === job && x.by.startsWith("agent")) ?? null;
});
$effect(() => {
  if (th && !loop.messages.has(th.id)) void loop.loadThread(th.id);
});

// ---------------------------------------------------------------- actions
function close() {
  const ws = s.workspace.key;
  const block = th?.anchor.doc?.block;
  const sec = block ? s.doc.index?.blockSection.get(block) : undefined;
  s.ctx.back();
  if (ws) void s.router.go(sec ? { name: "doc", ws, section: sec, ...(block ? { block } : {}) } : { name: "map", ws }, { focus: "keep" });
}

async function finishWith(req: import("@mitori/core").AcceptReq) {
  rechecking = req.accept !== "all";
  const ok = await loop.accept(job, req);
  rechecking = false;
  if (ok) {
    loop.decisionTick++;
    close();
  } else void load();
}

function settle() {
  const o = outcome(d, units, { sensitive, unverified: warn !== "none" });
  if (o.kind === "accept") void finishWith(o.req);
  else if (o.kind === "reject") {
    loop.reject(job);
    close();
  }
}

function acceptKey() {
  const u = focusedUnit(d, units);
  if (!u) {
    if (sensitive) return;
    const req = acceptAll(units, { sensitive, unverified: warn !== "none" });
    if (req) void finishWith(req);
    return;
  }
  decide(d, units, u, "accept");
  loop.decisionTick++;
  settle();
}

function rejectKey() {
  const u = focusedUnit(d, units);
  if (!u) {
    loop.reject(job);
    close();
    return;
  }
  decide(d, units, u, "reject");
  loop.decisionTick++;
  settle();
}

function onDecide(unit: string, v: "accept" | "reject") {
  if (unit.startsWith("file:")) decide(d, units, { kind: "file", path: unit.slice(5) }, v);
  else {
    const u = units.find((x) => x.id === unit) as Unit | undefined;
    if (!u) return;
    if ((u.kind === "hunk" ? d.hunks.get(u.id) : d.proposals.get(u.id)) === v) clear(d, u);
    else decide(d, units, u, v);
  }
  loop.decisionTick++;
  settle();
}

function go(dir: 1 | -1) {
  const list = ready;
  if (list.length < 2) return;
  const i = list.findIndex((j) => j.id === job);
  const next = list[(i + dir + list.length) % list.length];
  const ws = s.workspace.key;
  if (next && ws) void s.router.go({ name: "review", ws, job: next.id });
}

onMount(() => {
  const k = s.keys;
  s.layers.open("ctxMode", "ctx-review", close);
  const offs = [
    k.on("review.accept", acceptKey),
    k.on("review.reject", rejectKey),
    k.on("review.acceptAll", () => {
      const req = acceptAll(units, { sensitive, unverified: warn !== "none" });
      if (req) void finishWith(req);
    }),
    k.on("review.nextHunk", () => {
      step(d, units, 1);
      loop.decisionTick++;
    }),
    k.on("review.prevHunk", () => {
      step(d, units, -1);
      loop.decisionTick++;
    }),
    k.on("review.widen", () => {
      s.ctx.wide = !s.ctx.wide;
      if (!s.ctx.wide) view = "unified";
    }),
    k.on("review.prevJob", () => go(-1)),
    k.on("review.nextJob", () => go(1)),
  ];
  return () => {
    for (const off of offs) off();
    s.layers.drop("ctx-review");
    s.ctx.wide = false;
  };
});

const mainLabel = $derived.by(() => {
  if (accepting) return rechecking ? t("review.rechecking") : t("review.accepting");
  if (focused) return t(focused.kind === "hunk" ? "review.acceptHunk" : "review.acceptProposal");
  if (warn === "failed") return t("review.acceptFailed");
  if (warn === "unverified") return t("review.acceptUnverified");
  return t("review.acceptAll");
});
const usage = $derived(summary?.usage);
const gateMs = $derived((summary?.gates ?? []).reduce((n, g) => n + g.ms, 0));
const estTok = $derived(
  summary ? summary.estimate.inTokens + summary.estimate.cacheReadTokens + summary.estimate.cacheWriteTokens + summary.estimate.outTokens : 0,
);
const realTok = $derived(usage ? usage.in + usage.cacheRead + usage.cacheWrite + usage.out : 0);
const quote = $derived(th?.anchor.doc?.quote?.exact ?? "");
/** The human's request (the thread's first human message; its title while the messages are not loaded) — NOT `preview`, the latest message (the AI's reply). */
const askText = $derived(((th ? loop.messages.get(th.id)?.find((m) => m.by === "human")?.body : undefined) ?? th?.title ?? "").trim());
// the panel has its own 「内容を見て承認」: the toast of a gate waiting for trust would cover the footer (accept / reject)
$effect(() => {
  void job;
  s.bottom.dismiss("trust.pending");
});
$effect(() => {
  const id = th?.id;
  if (id && !id.startsWith("tmp_") && !loop.messages.has(id)) void loop.loadThread(id);
});
const sec = $derived.by(() => {
  const b = th?.anchor.doc?.block;
  const id = b ? s.doc.index?.blockSection.get(b) : undefined;
  return id ? (s.doc.index?.numbers.get(id) ?? "") : "";
});
</script>

<div class="rv" class:wide data-chrome>
  {#if error}
    <div class="err-card" role="alert"><p>{error}</p><button type="button" class="btn btn-sec btn-s" onclick={() => void load()}>{t("app.retry")}</button></div>
  {:else if !summary}
    <div class="skel" style="height: 120px; margin: 24px"></div>
  {:else}
    <header class="rv-h">
      <p class="meta mono">
        {#if th}{th.id} · R{th.round} · {/if}{summary.route.mode} mode · tools {summary.route.tools === "none" ? t("review.tools.none") : "Read + Edit"}
        {#if position.total > 1}<span class="pos">{position.index + 1}/{position.total}</span>{/if}
        <button type="button" class="close" onclick={close}>× {t("review.close")}<kbd>Esc</kbd></button>
      </p>
      <h2>{t(`composer.intent.${th?.intent ?? "change"}`)}{t("review.titleSep")}<span data-user-content>{th?.title ?? ""}</span></h2>
      <p class="ask">§{sec}<q data-user-content>{quote.slice(0, 40)}</q> <span class="mono">{th?.anchor.doc?.block ?? ""}</span> · {t("review.you")}<q data-user-content>{askText.slice(0, 60)}</q></p>
    </header>

    {#if resolvedElsewhere}<p class="elsewhere">{t("review.elsewhere")}</p>{/if}

    <div class="scroll">
      <div class="gates">
        {#each summary.gates as g (g.gate)}
          <span class="gp mono" data-st={g.status} title={g.gate}>
            {g.status === "pass" ? "✓" : g.status === "fail" || g.status === "error" || g.status === "timeout" ? "✕" : "⚠"}
            {gateLabel(g.gate)}{#if g.autofixed} {t("review.gate.autofixed")}{/if}{#if g.status === "pass" || g.status === "fail"} · {(g.ms / 1000).toFixed(1)}s{:else} · {t(`review.gate.${g.status}`)}{/if}
          </span>
        {/each}
        <span class="gp mono" data-st={summary.writeScope.length ? "pass" : "skipped"}>✓ {t("review.scope", { n: summary.diffStat?.files ?? summary.writeScope.length })}</span>
      </div>
      {#if badge.kind === "unverified"}
        <p class="unv">⚠ {t("jobs.ready.unverified", { n: badge.unchecked + badge.pending })}
          {#if badge.unchecked}<button type="button" class="link" onclick={() => (loop.trustOpen = [...loop.trust.values()].find((r) => r.status === "pending") ?? null)}>{t("jobs.ready.approve")}</button>{/if}
          {#if badge.pending}<button type="button" class="btn btn-sec btn-s" onclick={() => void loop.runGates(job)}>{t("jobs.ready.runGates")}</button>{/if}
        </p>
      {:else if badge.kind === "rechecking"}
        <p class="unv">{t("jobs.ready.rechecking")}</p>
      {/if}

      {#if usage}
        <div class="actual mono">
          <span>{t("review.actual.in")} <b>{fmtTokens(usage.in + usage.cacheWrite)}</b> cache {fmtTokens(usage.cacheRead)}</span>
          <span>{t("review.actual.out")} <b>{fmtTokens(usage.out)}</b></span>
          <span><b>{fmtUsd(usage.apiUsd, "job")}</b> {t("review.actual.api")}</span>
          {#if summary.timings}<span><b>{(summary.timings.wallMs / 1000).toFixed(1)}s</b>（{t("review.actual.split", { m: (summary.timings.modelMs / 1000).toFixed(0), g: (gateMs / 1000).toFixed(1) })}）</span>{/if}
          <span class="est">{t("review.actual.est", { k: fmtTokens(estTok, { approx: true }), d: fmtDelta(realTok, estTok) })}{#if summary.windowDeltaPct != null} · 5h +{summary.windowDeltaPct}%{/if}</span>
        </div>
      {/if}

      {#if resultSummary.length || doneMsg || fmtLines > 0}
        <section class="sum">
          <h3>{t("review.summary")}<span class="src">{t("review.summarySrc", { n: resultSummary.length })}</span></h3>
          {#if resultSummary.length}
            <ul>
              {#each resultSummary as item, i (i)}<li data-user-content>{item}</li>{/each}
              {#if fmtLines > 0}<li>{t("review.whitespace", { n: fmtLines })}</li>{/if}
            </ul>
          {:else if doneMsg}
            <ServerHtml html={doneMsg.html} fallback={doneMsg.body} />
          {/if}
        </section>
      {/if}

      {#if detail}
        <section class="code">
          <h3>{t("review.code")}<span class="src mono">{t("review.codeMeta", { files: detail.diff.length, a: summary.diffStat?.additions ?? 0, d: summary.diffStat?.deletions ?? 0 })} · n / ⇧N</span>
            {#if wide}
              <span class="seg" role="radiogroup" aria-label={t("review.view")}>
                <button type="button" role="radio" aria-checked={view === "unified"} onclick={() => (view = "unified")}>Unified</button>
                <button type="button" role="radio" aria-checked={view === "split"} onclick={() => (view = "split")}>Split</button>
              </span>
            {/if}
          </h3>
          <DiffView files={detail.diff} focus={focused?.kind === "hunk" ? focused.id : null} decisions={hunkDecisions} {view} version={tick} ondecide={onDecide} />
        </section>
        {#if detail.proposalViews.length}
          <section class="props">
            <h3>{t("review.proposals")}</h3>
            <ul>
              {#each detail.proposalViews as p (p.id)}
                {@const dec = d.proposals.get(p.id)}
                <li class:focus={focused?.id === p.id} data-dec={dec ?? null}>
                  <span class="mono">§{s.doc.index?.numbers.get(p.section) ?? p.section}</span>
                  <span class="pt" data-user-content>{p.md.slice(0, 24)}</span>
                  <span class="op">· {t(`review.op.${p.op}`)}</span>
                  <button type="button" class="link" onclick={() => {
                    const ws = s.workspace.key;
                    if (ws && p.block) document.querySelector(`.blk[data-b="${CSS.escape(p.block)}"]`)?.scrollIntoView({ block: "center" });
                  }}>{t("review.inProse")}</button>
                  <span class="dec">
                    <button type="button" class="dbtn ok" class:on={dec === "accept"} aria-label={t("proposals.accept")} onclick={() => onDecide(p.id, "accept")}>✓</button>
                    <button type="button" class="dbtn no" class:on={dec === "reject"} aria-label={t("proposals.reject")} onclick={() => onDecide(p.id, "reject")}>✕</button>
                  </span>
                  {#if p.diffHtml}<div class="pdiff"><ServerHtml html={p.diffHtml} cls="pd" /></div>{/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {:else}
        <div class="skel" style:height="{Math.min(600, 22 * ((summary.diffStat?.additions ?? 10) + (summary.diffStat?.deletions ?? 0)))}px"></div>
      {/if}
    </div>

    <footer class="rv-f">
      {#if out.kind === "pending" && out.decided > 0}<span class="prog mono">{t("review.decided", { d: out.decided, n: out.total })}</span>{/if}
      <div class="btns">
        {#if !sensitive || focused}
          <button type="button" class="btn btn-pri main" class:warn={!focused && warn !== "none"} disabled={accepting || resolvedElsewhere} onclick={acceptKey}>
            <span class="lbl">{mainLabel}</span><kbd>{s.keys.label("Mod+Enter")}</kbd>
          </button>
        {/if}
        <button type="button" class="btn btn-sec" disabled={accepting || resolvedElsewhere} onclick={rejectKey}>{focused ? t("review.rejectUnit") : t("review.reject")}<kbd>{s.keys.label("Mod+Backspace")}</kbd></button>
      </div>
      <p class="hint">{t("review.footHint", { n: "n", N: "⇧N", acc: s.keys.label("Mod+Enter"), rej: s.keys.label("Mod+Backspace"), all: s.keys.label("Alt+Mod+Enter") })}<span class="mono base"> · base {summary.baseRef ?? `refs/mitori/j/${job}/base`}</span></p>
    </footer>
  {/if}
</div>

<style>
  .rv {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--paper);
    font-size: var(--fs-ui);
  }
  .rv.wide {
    position: fixed;
    inset: var(--hdr) 40px var(--status) 40px;
    z-index: var(--z-overlay);
    border: 1px solid var(--rule);
    border-radius: var(--r-card-l);
    box-shadow: var(--shadow-pop);
  }
  .rv-h {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    padding: 18px 28px 14px;
    border-bottom: 1px solid var(--rule);
    background: color-mix(in srgb, var(--paper) 94%, transparent);
    backdrop-filter: blur(8px);
  }
  .rv-h .meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .rv-h .pos {
    margin-left: auto;
  }
  .rv-h .close {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font-family: var(--font-ui);
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .rv-h .pos + .close {
    margin-left: 10px;
  }
  .rv-h .close:hover {
    color: var(--ink);
  }
  .rv-h h2 {
    margin: 10px 0 6px;
    font-family: var(--font-serif);
    font-size: var(--fs-title-s);
    font-weight: var(--fw-strong);
    color: var(--ink);
    line-height: var(--lh-h2);
  }
  .rv-h .ask q {
    quotes: "\201C" "\201D";
  }
  :global(html:lang(ja)) .rv-h .ask q {
    quotes: "\300C" "\300D";
  }
  .rv-h .ask {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.7;
  }
  .elsewhere {
    margin: 0;
    padding: 8px 28px;
    background: var(--c-warn-bg);
    color: var(--c-warn);
    font-size: var(--fs-label);
  }
  .scroll {
    flex: 1;
    overflow: auto;
    padding: 16px 28px 24px;
  }
  .gates {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 6px;
  }
  .gp {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 30px;
    padding: 4px 10px;
    border-radius: var(--r-input);
    background: var(--c-ok-bg);
    color: var(--c-ok);
    font-size: var(--fs-meta);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gp[data-st="fail"],
  .gp[data-st="error"],
  .gp[data-st="timeout"] {
    background: var(--c-bad-bg);
    color: var(--c-bad);
  }
  .gp[data-st="skipped"],
  .gp[data-st="untrusted"],
  .gp[data-st="pending_consent"] {
    background: var(--paper-2);
    color: var(--muted);
  }
  .unv {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--c-warn);
  }
  .actual {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 14px;
    padding: 12px 16px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .actual b {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .actual .est {
    margin-left: auto;
  }
  h3 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 22px 0 8px;
    font-size: var(--fs-label);
    font-weight: var(--fw-strong);
    color: var(--muted);
    letter-spacing: var(--ls-caps);
  }
  h3 .src {
    margin-left: auto;
    font-weight: var(--fw-regular);
    letter-spacing: 0;
    font-size: var(--fs-meta);
  }
  .sum ul {
    margin: 0;
    padding-left: 1.2em;
    color: var(--text);
    line-height: 1.75;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--rule);
    border-radius: var(--r-btn);
    overflow: hidden;
  }
  .seg button {
    padding: 2px 10px;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .seg button[aria-checked="true"] {
    background: var(--ink);
    color: var(--paper);
  }
  .props ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .props li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--rule-soft);
    font-size: var(--fs-label);
  }
  .props li.focus {
    background: var(--c-prop-bg);
  }
  /* the change itself, in suggestion mode (the same diff the prose shows): what accept writes into the doc */
  .props .pdiff {
    flex-basis: 100%;
    max-height: 9.5em;
    overflow: auto;
    padding: 6px 10px;
    border-radius: var(--r-input);
    background: var(--sugg-bg);
    box-shadow: inset 2px 0 0 var(--c-prop);
    font-family: var(--font-prose);
    font-size: var(--fs-ui-s);
    line-height: 1.7;
    color: var(--text);
  }
  .props .pdiff :global(p) {
    margin: 0;
  }
  .props .pdiff :global(del.d) {
    color: var(--del-fg);
    text-decoration: line-through;
    background: var(--del-bg);
    border-radius: 3px;
  }
  .props .pdiff :global(ins.a) {
    color: var(--add-fg);
    text-decoration: underline;
    text-underline-offset: 3px;
    background: var(--add-bg);
    border-radius: 3px;
  }
  .props .pt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .props .op {
    color: var(--muted);
    white-space: nowrap;
  }
  .props .dec {
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
  }
  .dbtn {
    width: 28px;
    height: 28px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-btn);
    background: var(--sheet);
    color: var(--muted);
  }
  .dbtn.ok.on {
    background: var(--c-ok-bg);
    color: var(--c-ok);
    border-color: var(--c-ok);
  }
  .dbtn.no.on {
    background: var(--c-bad-bg);
    color: var(--c-bad);
    border-color: var(--c-bad);
  }
  .rv-f {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 12px 28px;
    border-top: 1px solid var(--rule);
    background: var(--paper);
  }
  .rv-f .btns {
    display: flex;
    gap: 8px;
  }
  .rv-f .main {
    display: inline-grid;
    grid-auto-flow: column;
  }
  .rv-f .main.warn {
    background: var(--c-warn);
  }
  .rv-f kbd {
    margin-left: 8px;
    background: none;
    color: inherit;
    border-color: color-mix(in srgb, var(--rule-2) 60%, transparent);
  }
  .rv-f .prog {
    font-size: var(--fs-label);
    color: var(--ink);
  }
  .rv-f .hint {
    margin: 0 0 0 auto;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .rv-f .base {
    font-size: var(--fs-meta);
  }
</style>
