<!--
  Inbox detail (ux.md §4.6.4, JUDGEMENT §6.9, prototype 04): title, anchor, quote and messages for every kind, then
  the kind's own body — the doc_edit 2-way choice (`DOC_EDIT_CHOICES`: 1 = make the code follow, 2 = fix the doc,
  same order and keys everywhere), the ready summary, the failure chain with the next actions (escalation only after a
  second confirmation naming the amount, AC-J39), the outdated snapshot, answers, the trust body and proposals.
  ［設計書で開く ↵］［地図で見る］ on all.
-->
<script lang="ts">
import { type InboxItem, type JobEstimate, MitoriError, type ThreadDetail, type ThreadId } from "@mitori/core";
import { DOC_EDIT_CHOICES } from "../contract.ts";
import { gateBadge } from "../jobs/gates.ts";
import { errorText, fmtTokens, fmtUsd, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { loopOf } from "../threads/loop.svelte.ts";
import ServerHtml from "../threads/ServerHtml.svelte";
import StatusPill from "../threads/StatusPill.svelte";
import TrustBody from "../trust/TrustBody.svelte";
import { itemStatus } from "./status.ts";
import { needsChoice } from "./view.ts";

let { item, onopen }: { item: InboxItem; onopen: (it: InboxItem) => void } = $props();
const s = useStores();
const loop = loopOf(s);
const status = $derived(itemStatus(item));
let detail = $state.raw<ThreadDetail | null>(null);
let choiceEst = $state.raw<JobEstimate | null>(null);
let busy = $state(false);
let escalate = $state.raw<JobEstimate | null>(null);
let reply = $state("");

const thId = $derived((item.thread ?? (item.kind === "thread" ? item.id : null)) as ThreadId | null);
const job = $derived(item.job ? (s.review.jobs.get(item.job) ?? null) : thId ? loop.jobOf(thId) : null);
const msgs = $derived(thId ? (loop.messages.get(thId) ?? detail?.messages ?? []) : []);
const trust = $derived(item.kind === "trust" ? (loop.trust.get(item.id as `tr_${string}`) ?? null) : null);
const choice = $derived(needsChoice(item));

$effect(() => {
  const id = thId;
  detail = null;
  choiceEst = null;
  escalate = null;
  if (!id || id.startsWith("tmp_")) return;
  void loop.loadThread(id).then((d) => {
    if (d && thId === id) detail = d;
  });
});

$effect(() => {
  // the 2-way choice shows the code path's cost (estimate on the draft thread, server spec §4.4)
  const id = thId;
  const ws = s.workspace.key;
  if (!choice || !id || !ws) return;
  void s.api.call("POST /ws/:ws/jobs/estimate", { params: { ws }, body: { kind: "fix", threads: [id] } }).then(
    (e) => {
      if (thId === id) choiceEst = e;
    },
    () => {},
  );
});

export async function choose(target: "code" | "doc"): Promise<void> {
  const d = detail;
  const block = d?.anchor.doc?.block;
  if (!d || !block || busy) return;
  busy = true;
  await loop.chooseDocEdit(d.id, target, block, d.messages[0]?.body ?? "", d.anchor.doc?.blockHash ?? "");
  busy = false;
}

async function askEscalate() {
  const ws = s.workspace.key;
  if (!ws || !thId) return;
  try {
    escalate = await s.api.call("POST /ws/:ws/jobs/estimate", {
      params: { ws },
      body: { kind: "fix", threads: [thId], mode: "agent", model: s.session.settings?.settings.models.escalate ?? "claude-opus-5-5" },
    });
  } catch (err) {
    s.bottom.toast({ id: "loop.error", kind: "error", key: "review.toast.failed", params: { error: errorText(MitoriError.from(err).toData()) } });
  }
}

async function runEscalate() {
  const ws = s.workspace.key;
  const e = escalate;
  if (!ws || !thId || !e) return;
  escalate = null;
  try {
    const j = await s.api.call("POST /ws/:ws/jobs", {
      params: { ws },
      body: { kind: "fix", threads: [thId], mode: "agent", model: e.route.model, estimateId: e.estimate.id, confirm: true },
    });
    s.review.jobs.set(j.id, j);
  } catch (err) {
    s.bottom.toast({ id: "loop.error", kind: "error", key: "review.toast.failed", params: { error: errorText(MitoriError.from(err).toData()) } });
  }
}

function map() {
  const ws = s.workspace.key;
  if (ws) void s.router.go({ name: "map", ws });
}
const choiceTok = $derived(choiceEst ? choiceEst.estimate.inTokens + choiceEst.estimate.cacheReadTokens + choiceEst.estimate.outTokens : null);
const quote = $derived(detail?.anchor.doc?.quote?.exact ?? "");
const anchorLine = $derived.by(() => {
  const a = item.anchor;
  const parts: string[] = [];
  if (a?.section) parts.push(`§${s.doc.index?.numbers.get(a.section) ?? a.section}`);
  if (a?.path) parts.push(`${a.path}${a.line ? `:${a.line}` : ""}`);
  if (s.doc.level === "expert" && detail?.anchor.doc?.block) parts.push(detail.anchor.doc.block);
  return parts.join(" · ");
});
</script>

<div class="det" data-chrome>
  <p class="kid mono">{#if s.doc.level === "expert"}{item.id} · {/if}{item.intent ? t(`composer.intent.${item.intent}`) : t(`inbox.kind.${item.kind}`)}</p>
  <h2 data-user-content>{item.title}</h2>
  {#if anchorLine}<p class="anc mono">{anchorLine}</p>{/if}
  <p class="pill"><StatusPill {status} /></p>

  {#if choice}
    {#if msgs[0]}<blockquote class="q"><ServerHtml html={msgs[0].html} fallback={msgs[0].body} /></blockquote>{/if}
    <p class="lead">{t("inbox.choice.lead")}</p>
    <div class="choices">
      {#each DOC_EDIT_CHOICES as c (c.key)}
        <button type="button" class="ch" disabled={busy} onclick={() => void choose(c.target)}>
          <span class="k mono">{c.key}</span>
          <span class="tt"><b>{t(c.i18n)}</b>
            <span class="d">{c.target === "doc" ? t("inbox.choice.docD") : choiceTok !== null && choiceEst ? t("inbox.choice.codeD", { mode: choiceEst.route.mode, k: fmtTokens(choiceTok, { approx: true }), usd: fmtUsd(choiceEst.estimate.apiUsd, "job") }) : t("inbox.choice.codeLoading")}</span>
          </span>
        </button>
      {/each}
    </div>
    <p class="keys"><kbd>1</kbd> / <kbd>2</kbd> {t("inbox.choice.keys")}</p>
  {:else if item.kind === "trust" && trust}
    <TrustBody request={trust} />
    <div class="row">
      <button type="button" class="btn btn-sec btn-s" onclick={() => void loop.decideTrust(trust.id, "denied")}>{t("trust.deny")}</button>
      <button type="button" class="btn btn-pri btn-s" onclick={() => void loop.decideTrust(trust.id, "trusted")}>{t("trust.approve")}</button>
    </div>
  {:else}
    {#if quote}<blockquote class="q" data-user-content>{quote}</blockquote>{/if}
    {#if job && job.state === "ready"}
      {@const b = gateBadge(job)}
      <p class="facts mono">
        +{job.diffStat?.additions ?? 0} −{job.diffStat?.deletions ?? 0} · {t("jobs.ready.files", { n: job.diffStat?.files ?? 0 })} · {t("jobs.ready.hunks", { n: job.diffStat?.hunks ?? 0 })}
        {#if b.kind === "passed"} · ✓ {t("jobs.ready.gates", { p: b.pass, n: b.total })}{:else if b.kind === "unverified"} · ⚠ {t("jobs.ready.unverified", { n: b.unchecked + b.pending })}{:else if b.kind === "failed"} · ✕ {t("jobs.ready.gates", { p: b.pass, n: b.total })}{/if}
      </p>
      <div class="row">
        <button type="button" class="btn btn-pri btn-s" onclick={() => { const ws = s.workspace.key; if (ws) void s.router.go({ name: "review", ws, job: job.id }); }}>{t("jobs.ready.review")}<kbd>R</kbd></button>
        {#if !job.sensitive}<button type="button" class="btn btn-sec btn-s" onclick={() => void loop.accept(job.id, { accept: "all", ...(job.proposals.length ? { proposals: job.proposals } : {}) })}>{t("jobs.ready.accept")}</button>{/if}
        <button type="button" class="btn btn-gh" onclick={() => loop.reject(job.id)}>{t("jobs.ready.reject")}</button>
      </div>
    {:else if job && job.state === "failed" && job.failure}
      <div class="fail">
        <p class="chain mono">{#if job.escalatedFrom}{t("inbox.fail.chain", { from: job.escalatedFrom })} → {/if}{job.route.mode} → {t(`error.${job.failure.code}`)}</p>
        {#if job.failure.stderrTail?.length}<pre class="mono">{job.failure.stderrTail.join("\n")}</pre>{/if}
        <p class="mono cost">{t("jobs.fail.cost", { usd: fmtUsd(job.usage?.apiUsd ?? 0, "job"), n: job.attempt })}</p>
        <div class="row">
          {#each job.failure.actions as a (a)}
            {#if a === "retry"}<button type="button" class="btn btn-sec btn-s" onclick={() => void loop.retryJob(job.id)}>{t("inbox.fail.retry")}</button>{/if}
            {#if a === "other_engine"}<button type="button" class="btn btn-gh" onclick={() => void loop.retryJob(job.id, "anthropic-api")}>{t("inbox.fail.otherEngine")}</button>{/if}
            {#if a === "copy_prompt" && detail}<button type="button" class="btn btn-gh" onclick={() => detail && void loop.copyPrompt(detail.anchor, detail.messages[0]?.body ?? "", detail.intent)}>{t("jobs.confirm.copy")}</button>{/if}
            {#if a === "narrow_scope"}<button type="button" class="btn btn-gh" onclick={() => onopen(item)}>{t("jobs.confirm.narrow")}</button>{/if}
            {#if a === "escalate"}<button type="button" class="btn btn-gh" onclick={() => void askEscalate()}>{t("inbox.fail.escalate")}</button>{/if}
          {/each}
        </div>
        {#if escalate}
          <div class="confirm" role="alertdialog" aria-label={t("inbox.fail.escalateTitle")}>
            <p>{t("inbox.fail.escalateConfirm", { usd: fmtUsd(escalate.estimate.apiUsd, "job"), model: escalate.route.model })}</p>
            <div class="row"><button type="button" class="btn btn-pri btn-s" onclick={() => void runEscalate()}>{t("inbox.fail.escalateRun", { usd: fmtUsd(escalate.estimate.apiUsd, "job") })}</button><button type="button" class="btn btn-gh" onclick={() => (escalate = null)}>{t("review.cancel")}</button></div>
          </div>
        {/if}
        <p class="keep">{t("jobs.fail.kept")}</p>
      </div>
    {:else if job && job.state === "waiting_lock"}
      <p class="lock">{t("inbox.lock")}</p>
    {/if}
    {#if status === "outdated"}
      <p class="snap-h">{t("inbox.outdated.snapshot")}</p>
      <blockquote class="snap" data-user-content>{quote}</blockquote>
      <div class="row">
        <button type="button" class="btn btn-sec btn-s" onclick={() => { loop.reanchoring = thId; onopen(item); }}>{t("inbox.outdated.reanchor")}</button>
        {#if thId}<button type="button" class="btn btn-gh" onclick={() => thId && void loop.transition(thId, "resolve", { resolution: "wontfix" })}>{t("inbox.outdated.resolve")}</button>{/if}
      </div>
    {/if}
    {#if msgs.length}
      <div class="msgs">
        {#each msgs as m (m.id)}
          <div class="m"><p class="mw">{m.by === "human" ? t("threads.who.you") : m.by.startsWith("agent:") ? t("threads.who.agent", { name: m.by.slice(6) }) : t("threads.who.system")}</p><ServerHtml html={m.html} fallback={m.body} /></div>
        {/each}
      </div>
    {/if}
    {#if thId && item.state === "answered"}
      <div class="row">
        <button type="button" class="btn btn-sec btn-s" onclick={() => thId && void loop.promote(thId, "doc")}>{t("threads.promoteDoc")}</button>
        <button type="button" class="btn btn-gh" onclick={() => thId && void loop.promote(thId, "decision")}>{t("threads.promoteDecision")}</button>
      </div>
    {/if}
    {#if thId && (item.state === "needs_input" || item.state === "answered")}
      <textarea class="reply" bind:value={reply} aria-label={t("threads.reply.label")} placeholder={t("threads.reply.placeholder")}></textarea>
      <div class="row"><button type="button" class="btn btn-pri btn-s" disabled={!reply.trim()} onclick={async () => { if (thId && (await loop.transition(thId, "reply", { message: reply }))) reply = ""; }}>{t("threads.reply.send")}</button></div>
    {/if}
  {/if}

  <div class="nav">
    <button type="button" class="btn btn-sec btn-s" onclick={() => onopen(item)}>{t("inbox.openDoc")}<kbd>↵</kbd></button>
    <button type="button" class="btn btn-gh" onclick={map}>{t("inbox.openMap")}</button>
  </div>
</div>

<style>
  .det {
    padding: 36px 28px 40px;
    font-size: var(--fs-ui);
  }
  .kid {
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  h2 {
    margin: 8px 0 6px;
    font-family: var(--font-serif);
    font-size: var(--fs-title);
    font-weight: var(--fw-strong);
    color: var(--ink);
    line-height: 1.45;
  }
  .anc {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .pill {
    margin: 12px 0 0;
  }
  .q,
  .snap {
    margin: 16px 0 0;
    padding: 12px 16px;
    border-left: 3px solid var(--mark);
    border-radius: 0 var(--r-input) var(--r-input) 0;
    background: var(--paper-2);
    color: var(--text);
    line-height: 1.8;
  }
  .snap {
    color: var(--muted);
  }
  .snap-h {
    margin: 16px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .lead {
    margin: 16px 0 10px;
    color: var(--text);
    line-height: 1.8;
  }
  .choices {
    display: grid;
    gap: 10px;
  }
  .ch {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    padding: 16px 18px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    text-align: left;
  }
  .ch:hover,
  .ch:focus-visible {
    border-color: var(--ink);
  }
  .ch .k {
    color: var(--muted);
    font-size: var(--fs-ui);
  }
  .ch b {
    display: block;
    margin-bottom: 4px;
    color: var(--ink);
    font-weight: var(--fw-strong);
    font-size: var(--fs-ui-l);
  }
  .ch .d {
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.6;
  }
  .keys {
    margin: 10px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .row kbd,
  .nav kbd {
    margin-left: 6px;
    background: none;
    color: inherit;
  }
  .facts {
    margin: 14px 0 0;
    font-size: var(--fs-label);
    color: var(--text);
  }
  .fail {
    margin-top: 14px;
  }
  .fail .chain {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--c-bad);
  }
  .fail pre {
    margin: 8px 0;
    padding: 8px 10px;
    border-radius: var(--r-chip);
    background: var(--paper-2);
    font-size: var(--fs-meta);
    white-space: pre-wrap;
  }
  .fail .cost {
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .confirm {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: var(--r-input);
    background: var(--c-warn-bg);
    font-size: var(--fs-label);
  }
  .confirm p {
    margin: 0;
  }
  .keep,
  .lock {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .msgs {
    margin-top: 16px;
  }
  .m {
    padding: 8px 0;
    border-top: 1px solid var(--rule-soft);
  }
  .m .mw {
    margin: 0 0 2px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .reply {
    display: block;
    width: 100%;
    min-height: 64px;
    margin-top: 12px;
    padding: 8px 10px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-input);
    font: inherit;
    resize: vertical;
  }
  .nav {
    display: flex;
    gap: 6px;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--rule-soft);
  }
</style>
