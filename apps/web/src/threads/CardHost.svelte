<!--
  One margin card per thread: the optimistic / running job card, the ready card, or the thread card — chosen from
  the thread's latest job and the pending submit (ux.md §6.3–6.5). Stage rows are `planStages(route)` folded with
  the job's real events; the elapsed counter ticks only while the job runs.
-->
<script lang="ts">
import type { JobSummary, ThreadSummary } from "@mitori/core";
import { onDestroy } from "svelte";
import { anchorOfTarget } from "../composer/targets.ts";
import { gateLabel } from "../jobs/gates.ts";
import { planStages } from "../jobs/index.ts";
import JobCard from "../jobs/JobCard.svelte";
import ReadyCard from "../jobs/ReadyCard.svelte";
import { foldStages, usualBand } from "../jobs/stages.ts";
import { useStores } from "../stores/app.svelte.ts";
import { loopOf, type Pending } from "./loop.svelte.ts";
import ThreadCard from "./ThreadCard.svelte";

let { thread, collapsed, active, onexpand }: { thread: ThreadSummary; collapsed: boolean; active: boolean; onexpand: () => void } = $props();

const s = useStores();
const loop = loopOf(s);
const pending = $derived<Pending | null>(loop.pendingOf(thread.id));
const job = $derived<JobSummary | null>(loop.jobOf(thread.id) ?? (pending?.job ? (s.review.jobs.get(pending.job) ?? null) : null));
const showIds = $derived(s.doc.level === "expert");
const rejected = $derived(!!job && s.review.pendingRejects.has(job.id));

/** The optimistic job: the route predicted at ⌘⏎, replaced by the server's job when it lands. */
const tempJob = $derived.by<JobSummary | null>(() => {
  const p = pending;
  if (!p || job) return null;
  return {
    id: p.key as `j_${string}`,
    ws: s.workspace.key as `ws_${string}`,
    kind: "fix",
    threads: p.thread ? [p.thread] : [],
    engine: "claude-cli",
    route: p.estimate?.route ?? {
      mode: p.mode,
      reason: "small_change",
      model: p.model as "claude-sonnet-5-5",
      effort: "medium",
      tools: "none",
      contract: "patch/1",
      anchoredLines: 0,
      files: 0,
      requiresConfirm: false,
    },
    state: "queued",
    attempt: 1,
    estimate: p.estimate?.estimate ?? ({} as JobSummary["estimate"]),
    writeScope: [],
    gates: [],
    proposals: [],
    promptVer: "loop@1",
    createdAt: new Date(p.t0).toISOString(),
  };
});

const shown = $derived(job ?? tempJob);
const events = $derived(shown ? s.review.events(shown.id) : []);
$effect(() => {
  if (job && loop.isRunning(job)) void loop.ensureEvents(job.id);
});

const view = $derived.by(() => {
  const j = shown;
  if (!j) return null;
  const gates = j.gates.length ? j.gates.map((g) => ({ id: g.gate, label: gateLabel(g.gate) })) : [];
  const plan = pending && !job ? pending.rows : planStages(j.route, gates);
  const t0 = pending?.t0 ?? Date.parse(j.startedAt ?? j.createdAt);
  return { ...foldStages(plan, j.route.mode, events, t0, j.state, j.finishedAt ? Date.parse(j.finishedAt) : null), t0 };
});

// elapsed counter (only while running)
let now = $state(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
$effect(() => {
  const run = !!shown && (loop.isRunning(shown) || (!!pending && pending.phase === "sending"));
  if (run && !timer) timer = setInterval(() => (now = Date.now()), 200);
  if (!run && timer) {
    clearInterval(timer);
    timer = null;
  }
});
onDestroy(() => {
  if (timer) clearInterval(timer);
});
const elapsed = $derived(view ? Math.max(0, (shown?.finishedAt ? Date.parse(shown.finishedAt) : now) - view.t0) : 0);

const quote = $derived(thread.anchor.doc?.quote?.exact ?? pending?.quote ?? "");
const body = $derived(pending?.body ?? thread.preview);
const runningForm = $derived(
  !!shown &&
    (loop.isRunning(shown) ||
      (shown.state === "failed" && !!job) ||
      (!!pending && !job) ||
      (shown.state === "done" && !loop.messages.get(thread.id)?.some((m) => m.job === shown.id))),
);

function review() {
  const ws = s.workspace.key;
  if (ws && job) void s.router.go({ name: "review", ws, job: job.id });
}
function copyFromPending() {
  const p = pending;
  if (!p) return;
  void loop.copyPrompt(anchorOfTarget(p.session.target), p.body, p.intent);
}
</script>

{#if rejected}
  <!-- hidden while the deferred reject waits for its undo window -->
{:else if shown && view && runningForm}
  <JobCard
    job={shown}
    rows={view.rows}
    tail={view.tail}
    elapsedMs={elapsed}
    usual={usualBand(shown.route.mode, pending?.estimate?.history)}
    answer={view.answer}
    oncancel={() => (job ? void loop.cancelJob(job.id) : undefined)}
    intent={thread.intent}
    {quote}
    {body}
    acceptMs={pending?.acceptMs ?? null}
    form={pending && !job ? (pending.phase === "sending" ? "run" : pending.phase) : "run"}
    estimate={pending?.estimate ?? null}
    error={pending?.error ?? null}
    {showIds}
    round={thread.round}
    onconfirm={() => pending && loop.confirm(pending.key)}
    onnarrow={() => pending && loop.narrow(pending.key)}
    oncopy={copyFromPending}
    onretry={() => pending && loop.retrySubmit(pending.key)}
  />
{:else if job && (job.state === "ready" || job.state === "accepting") && !collapsed}
  <ReadyCard
    {job}
    hunks={job.diffStat?.hunks ?? 0}
    gates={job.gates}
    onreview={review}
    onaccept={() => void loop.accept(job.id, { accept: "all", ...(job.proposals.length ? { proposals: job.proposals } : {}), ...(job.gateVerdict && job.gateVerdict !== "passed" ? { acceptUnverified: true } : {}) })}
    onreject={() => loop.reject(job.id)}
    intent={thread.intent}
    {quote}
    {body}
    accepting={loop.accepting.has(job.id)}
    onapprove={() => (loop.trustOpen = [...loop.trust.values()].find((r) => r.status === "pending") ?? null)}
    onrungates={() => void loop.runGates(job.id)}
  />
{:else}
  <ThreadCard {thread} {collapsed} {active} {showIds} {job} {onexpand} />
{/if}
