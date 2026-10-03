/**
 * The review engine (loop spec §2): threads, messages, rounds, Finish (push/pull), the Pull long-poll, carry-forward
 * and promotion. Every state change goes through core `assertTransition` (THREAD_TRANSITIONS incl. CR loop-1).
 *
 * Write discipline (ADR-0009, CONS-03): the synchronous mutators (`create`, `patch`, `transition`, `reply`,
 * `completeRound`, …) are called by the server inside the workspace `write()` slot and run in one SQLite
 * transaction (savepoint); their SSE events are published only after it commits. The async methods (`finish`,
 * `wait`, `promote`, `docEditToCode`, `estimateFinish`) enter `deps.write` themselves and never await inside it.
 *
 * Composition: `createLoop` (WP-08b) builds this with `createReviewEngine(deps)`; `jobs` is late-bound because the
 * job runner itself drives thread transitions through this engine. Contract for the runner: Finish(push) fires T2
 * (dispatch, human) and sets `batchRound` BEFORE calling `JobRunner.create`, so `create` must accept threads that
 * are already `queued` for that round (and fire T2 itself only for `open` threads).
 */
import type { AnchorSnapshot } from "@mitori/anchor";
import {
  type Anchor,
  type AnchorInput,
  assertTransition,
  type BlockId,
  type Clock,
  type CodeAnchor,
  type Decision,
  type DiagramId,
  type DocEditRes,
  type EffectiveSettings,
  type EstimateId,
  type EventSink,
  type FinishRes,
  HREFS,
  INTENT_JOB_KIND,
  type InboxFilter,
  type InboxItem,
  type JobEstimate,
  type JobId,
  type JobSummary,
  type Message,
  type MessageAuthor,
  type MessageView,
  MitoriError,
  newId,
  type ProposalId,
  parseRepoPath,
  type Random,
  type RepoPath,
  type Resolution,
  type ReviewEstimate,
  type ReviewStatus,
  type ReviewWaitRes,
  type Round,
  type SecretScanner,
  type SectionId,
  type SqlDb,
  type SseEventPayload,
  type Thread,
  type ThreadDetail,
  type ThreadId,
  type ThreadState,
  type ThreadSummary,
  type ThreadTrigger,
  type TransitionActor,
  type WorkspaceInfo,
  type WriteQueue,
} from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import { type JobRunner, type LoopDomainEvent, REVIEW_STDOUT, type ReviewEngine } from "../contract.ts";
import { anchorLabel, displayState, planBatch, renderDecisionMarkdown, renderDocEditAsk, renderReviewStdout } from "./index.ts";
import { ReviewStore, type RoundRecord } from "./store.ts";
import { firstLine, lf, plainHtml, titleOf } from "./text.ts";

/** Server-side anchor stamping result (`AnchorInput` → `Anchor` + capture-time auxiliary data). */
export interface CapturedAnchor {
  /** Full anchor (blob/snippet/symbol, blockHash/claim stamped by `AnchorEngine.codeAnchor/docAnchor`). */
  anchor: Anchor;
  /** Capture-time data per member for `rev_anchor_snapshots` (range text ≤ 4 KiB, symStart, diagram label/ref). */
  aux?: Partial<Record<AnchorSnapshot["member"], Pick<AnchorSnapshot, "text" | "symStart" | "label" | "ref">>>;
}

/** Ports of the review engine (a subset of `LoopDeps` plus the cross-WP seams). */
export interface ReviewEngineDeps {
  /** Workspace (key for hrefs, docDir for decision links). */
  ws: Pick<WorkspaceInfo, "key" | "docDir">;
  /** Workspace DB with `LOOP_MIGRATIONS` applied. */
  db: SqlDb;
  /** Workspace write queue (used by the async methods only). */
  write: WriteQueue;
  /** Ids. */
  random: Random;
  /** Timestamps. */
  clock: Clock;
  /** Secret scanner (agent replies, decision records). */
  secrets: SecretScanner;
  /** Settings (`limits.confirmAboveTokens`). */
  settings: () => EffectiveSettings;
  /** SSE. */
  events: EventSink<SseEventPayload>;
  /** Domain events (`round.completed`, `files.touched`). */
  domain: EventSink<LoopDomainEvent>;
  /**
   * `AnchorInput` → stamped `Anchor` (indexer blob/text + `AnchorEngine.codeAnchor`, doc `blockText` + `docAnchor`,
   * §1.2.1-5 code member derivation, §1.2.1-6 quote verification). Synchronous because `create`/`patch` are.
   * CR-PENDING(WP-07): not in `LoopDeps`; the composer supplies it (server pre-loads the file text).
   */
  captureAnchor(input: AnchorInput, previous: Anchor | null): CapturedAnchor;
  /** Doc store subset (block lookups, proposals, decision records). */
  doc: Pick<DocStore, "block" | "sections" | "propose" | "writeDecision">;
  /** Job runner, late-bound (`createLoop` builds it after the review engine). */
  jobs: () => Pick<JobRunner, "estimate" | "create">;
  /** Finish partition helpers (leaf module, router write scope, anchored lines; spec §3.2–3.3). */
  partition: { moduleOf(path: RepoPath): string; writeScopeOf(t: ThreadDetail): RepoPath[]; anchoredLinesOf(t: ThreadDetail): number };
  /** Message Markdown → HTML (markdown-it `html:false`). CR-PENDING(WP-07): no doc API yet; default escapes. */
  renderMarkdown?: (md: string) => string;
  /** Job summaries for `ThreadDetail.jobViews` (JobRunner.get). */
  jobView?: (id: JobId) => JobSummary | null;
  /** Bundle size for the `bundle≈k` header of `mitori.review/1` (pull tier rules, UXP-33). */
  bundleTokens?: (t: ThreadDetail) => number | null;
  /** Diagram node label for anchor labels. */
  diagramNodeLabel?: (dg: DiagramId, node: string) => string | null;
}

/** What the composer and the server need beyond the contract interface. */
export interface ReviewEngineHandle extends ReviewEngine {
  /** `GET /review` (pending = what Finish would send; held notes; waiter count). */
  status(): ReviewStatus;
  /** In-flight `wait` calls (daemon idle logic; the server de-duplicates by `x-mitori-waiter`). */
  waiters(): number;
  /** Daemon stop: every waiter gets `shutdown` + `approved:false`; later waits too. */
  shutdown(): void;
  /** Capture-time / last-ok anchor snapshots (outdated cards; `assembleAnchoredItems` reads spanLines/symStart). */
  snapshots(id: ThreadId): AnchorSnapshot[];
  /** SSE / list shape of one thread. */
  summary(id: ThreadId): ThreadSummary | null;
}

const REPLY_MAX_CHARS = 8000;
const RESOLVABLE: readonly ThreadState[] = ["open", "answered", "applied", "rejected", "failed", "needs_input"];
const DEFAULT_RESOLUTION: Partial<Record<ThreadState, Resolution>> = { answered: "answered", applied: "applied", rejected: "wontfix" };
const AGENT_TRIGGER = { done: "agent_done", answer: "answer", question: "ask_human" } as const satisfies Record<string, ThreadTrigger>;

interface Remembered {
  key: string;
  est: ReviewEstimate;
  partitionIds: EstimateId[];
}

interface Waiter {
  want: number | null;
  done: (r: ReviewWaitRes) => void;
}

const notFound = (id: string) => new MitoriError("E_NOT_FOUND", `thread ${id} not found`, { params: { id } });
const tokensOf = (e: JobEstimate) => e.estimate.inTokens + e.estimate.cacheReadTokens + e.estimate.cacheWriteTokens + e.estimate.outTokens;

/** Build the review engine (spec §2). */
export function createReviewEngine(deps: ReviewEngineDeps): ReviewEngineHandle {
  const store = new ReviewStore(deps.db);
  const now = () => deps.clock.iso();
  const remembered: Remembered[] = [];
  const waiting = new Set<Waiter>();
  let stopped = false;

  /* ---- event buffering: publish only after the transaction commits ---------------------------------------- */
  let buffer: (() => void)[] | null = null;
  const emit = (fn: () => void) => (buffer ? buffer.push(fn) : fn());
  function mutate<T>(fn: () => T): T {
    if (buffer) return fn();
    buffer = [];
    const out: (() => void)[] = buffer;
    try {
      const r = store.tx(fn);
      buffer = null;
      for (const f of out) f();
      return r;
    } catch (e) {
      buffer = null;
      throw e;
    }
  }

  /* ---- views ----------------------------------------------------------------------------------------------- */
  const html = (md: string) => (deps.renderMarkdown ? deps.renderMarkdown(md) : plainHtml(md));
  const view = (m: Message): MessageView => ({ ...m, html: html(m.body) });

  function summaryOf(t: Thread): ThreadSummary {
    const last = store.lastMessage(t.id);
    const s: ThreadSummary = {
      ...t,
      preview: Array.from(last?.body ?? "")
        .slice(0, 120)
        .join(""),
      messages: store.messageCount(t.id),
    };
    const js = store.latestJobState(t.id);
    if (js) s.jobState = js;
    return s;
  }

  function detailOf(t: Thread): ThreadDetail {
    const jobViews = deps.jobView ? t.jobs.map((j) => deps.jobView?.(j) ?? null).filter((j): j is JobSummary => j !== null) : [];
    return { ...t, messages: store.messages(t.id).map(view), jobViews };
  }

  const sectionOf = (block: BlockId): SectionId | null => deps.doc.block(block)?.section ?? null;
  const labelOf = (a: Anchor) => anchorLabel(a, { sectionOf, diagramNodeLabel: (dg, node) => deps.diagramNodeLabel?.(dg, node) ?? null });

  /* ---- rows ------------------------------------------------------------------------------------------------ */
  function load(id: ThreadId): Thread {
    const r = store.thread(id);
    if (!r) throw notFound(id);
    return r.thread;
  }

  function checkVersion(t: Thread, version: number): void {
    if (version !== t.version) throw new MitoriError("E_CONFLICT", `thread ${t.id} is at version ${t.version}`, { params: { id: t.id, version: t.version } });
  }

  function save(t: Thread): Thread {
    const next = { ...t, version: t.version + 1, updatedAt: now() };
    store.updateThread(next);
    emit(() => deps.events.emit({ type: "thread.upsert", thread: summaryOf(next) }));
    return next;
  }

  /** Fire one transition (core table is the only judge); applies the per-trigger field effects. */
  function fire(t: Thread, on: ThreadTrigger, by: TransitionActor, resolution?: Resolution): Thread {
    const to = assertTransition({ machine: "thread", from: t.state, on, by }) as ThreadState;
    const next: Thread = { ...t, state: to };
    if (on === "dispatch") next.stale = false;
    if (on === "resolve") next.resolution = resolution ?? DEFAULT_RESOLUTION[t.state] ?? "answered";
    if (on === "reopen") delete next.resolution;
    return next;
  }

  function addMessage_(thread: ThreadId, by: MessageAuthor, kind: Message["kind"], body: string, job?: JobId): Message {
    const m: Message = { id: newId("message", deps.random), thread, by, kind, body: lf(body), round: collectingN(), createdAt: now() };
    if (job) m.job = job;
    store.insertMessage(m);
    emit(() => deps.events.emit({ type: "thread.message", message: view(m) }));
    return m;
  }

  /* ---- rounds ---------------------------------------------------------------------------------------------- */
  function collecting(): RoundRecord | null {
    return store.rounds("WHERE state = 'collecting' ORDER BY n DESC LIMIT 1", [])[0] ?? null;
  }

  function collectingN(): number {
    return collecting()?.round.n ?? store.maxRound() + 1;
  }

  function putRound(rec: RoundRecord): void {
    store.upsertRound(rec);
    const round = rec.round;
    emit(() => deps.events.emit({ type: "review.round", round }));
  }

  function ensureCollecting(): RoundRecord {
    const c = collecting();
    if (c) return c;
    const rec: RoundRecord = {
      round: { n: store.maxRound() + 1, mode: "push", state: "collecting", threads: [], approved: false, startedAt: now() },
      deliveredAt: null,
      stdout: null,
      files: [],
      done: [],
    };
    putRound(rec);
    return rec;
  }

  /* ---- snapshots ------------------------------------------------------------------------------------------- */
  function snapshot(id: ThreadId, cap: CapturedAnchor, kinds: AnchorSnapshot["kind"][], replace: boolean): void {
    const at = now();
    for (const member of ["doc", "code", "diagram"] as const) {
      const anchor = cap.anchor[member];
      if (!anchor) continue;
      const aux = cap.aux?.[member] ?? {};
      for (const kind of kinds) {
        const s: AnchorSnapshot = { member, kind, anchor, at, ...aux };
        if (member === "code") s.spanLines = (anchor as CodeAnchor).end - (anchor as CodeAnchor).start;
        if (s.text !== undefined && s.text.length > 4096) s.text = s.text.slice(0, 4096);
        store.putSnapshot(id, s, replace);
      }
    }
  }

  /* ---- pending --------------------------------------------------------------------------------------------- */
  const sendable = (t: Thread) => t.state === "open" && (t.intent !== "note" || t.sendToAi === true);

  function pendingThreads(): Thread[] {
    return store.threads("WHERE state = 'open' ORDER BY created_at, id", []).filter(sendable);
  }

  /** Order of `mitori.review/1`: doc threads in TOC order, then code by path and line, then diagrams; then age. */
  function sortForPull(ts: Thread[]): Thread[] {
    const toc = new Map<BlockId, number>();
    let i = 0;
    for (const s of deps.doc.sections()) for (const b of s.blocks) toc.set(b, i++);
    const key = (t: Thread): [number, string, number, number] => {
      const a = t.anchor;
      if (a.primary === "doc" && a.doc) return [0, "", toc.get(a.doc.block) ?? Number.MAX_SAFE_INTEGER, a.doc.offset ?? 0];
      if (a.code) return [1, a.code.path, a.code.start, 0];
      return [2, a.diagram?.diagram ?? "", 0, 0];
    };
    return [...ts].sort((x, y) => {
      const a = key(x);
      const b = key(y);
      return (
        a[0] - b[0] ||
        (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) ||
        a[2] - b[2] ||
        a[3] - b[3] ||
        (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id < y.id ? -1 : 1)
      );
    });
  }

  /* ---- estimates ------------------------------------------------------------------------------------------- */
  async function estimate(targets: Thread[]): Promise<Remembered> {
    const details = targets.map(detailOf);
    const plans = planBatch(details, deps.partition);
    const runner = deps.jobs();
    const parts = await Promise.all(plans.map((p) => runner.estimate({ kind: p.kind, threads: p.threads })));
    const singles = await Promise.all(
      targets.map((t) => {
        const i = plans.findIndex((p) => p.threads.length === 1 && p.threads[0] === t.id);
        return i >= 0 ? (parts[i] as JobEstimate) : runner.estimate({ kind: INTENT_JOB_KIND[t.intent], threads: [t.id] });
      }),
    );
    const batchTokens = parts.reduce((s, e) => s + tokensOf(e), 0);
    const limit = deps.settings().global.limits.confirmAboveTokens;
    const est: ReviewEstimate = {
      estimateId: newId("estimate", deps.random),
      partitions: plans.map((p, i) => ({ threads: p.threads, kind: p.kind, estimate: parts[i] as JobEstimate })),
      batchTokens,
      separateTokens: singles.reduce((s, e) => s + tokensOf(e), 0),
      apiUsd: parts.reduce((s, e) => s + e.estimate.apiUsd, 0),
      requiresConfirm: batchTokens > limit || parts.some((e) => e.estimate.requiresConfirm),
    };
    const rec = {
      key: targets
        .map((t) => t.id)
        .sort()
        .join(","),
      est,
      partitionIds: parts.map((e) => e.estimate.id),
    };
    remembered.push(rec);
    if (remembered.length > 16) remembered.shift();
    return rec;
  }

  function targetsOf(ids: ThreadId[] | undefined | null, forFinish: boolean): Thread[] {
    if (!ids) return pendingThreads();
    const ts = [...new Set(ids)].map(load);
    if (!forFinish) return ts.filter((t) => t.intent !== "note" || t.sendToAi === true);
    const bad = ts.filter((t) => !sendable(t));
    if (bad.length > 0)
      throw new MitoriError("E_PRECONDITION", "only open threads (notes with sendToAi) can be finished", {
        params: { threads: bad.map((t) => t.id).join(",") },
      });
    return ts;
  }

  /* ---- pull ------------------------------------------------------------------------------------------------ */
  function renderRound(n: number, threads: { t: Thread; prev: number | undefined }[], approved: boolean): string {
    return renderReviewStdout({
      round: n,
      approved,
      threads: threads.map(({ t, prev }) => {
        const d = detailOf(t);
        const humanMessages = d.messages.filter((m) => m.by === "human" && (prev === undefined || m.round > prev));
        const entry: { thread: ThreadDetail; carriedFrom?: number; humanMessages: Message[]; anchorLabel: string; bundleTokens?: number } = {
          thread: d,
          humanMessages,
          anchorLabel: labelOf(t.anchor),
        };
        if (prev !== undefined) entry.carriedFrom = prev;
        const tokens = deps.bundleTokens?.(d);
        if (tokens !== null && tokens !== undefined) entry.bundleTokens = tokens;
        return entry;
      }),
    });
  }

  /** The pull round a waiter for `want` gets: the latest undelivered one (`null`) or the first ≥ want. */
  function deliverable(want: number | null): RoundRecord | null {
    if (want === null) {
      const last = store.rounds("WHERE mode = 'pull' ORDER BY n DESC LIMIT 1", [])[0];
      return last && last.deliveredAt === null && (last.round.state === "dispatched" || last.round.state === "complete") ? last : null;
    }
    return store.rounds("WHERE mode = 'pull' AND n >= ? AND state IN ('dispatched', 'complete') ORDER BY n LIMIT 1", [want])[0] ?? null;
  }

  async function deliver(n: number): Promise<ReviewWaitRes> {
    const rec = await deps.write("review.deliver", () =>
      mutate(() => {
        const r = store.round(n) as RoundRecord;
        if (r.deliveredAt === null) {
          for (const id of r.round.threads) {
            const t = store.thread(id)?.thread;
            if (t && t.state === "queued") save(fire(t, "start", "agent"));
          }
          r.deliveredAt = now();
          store.upsertRound(r);
        }
        return r;
      }),
    );
    const approved = rec.round.approved;
    return {
      status: "ready",
      round: rec.round,
      stdout: rec.stdout ?? renderRound(n, [], true),
      approved,
      next: approved ? "none" : `mitori review --round ${n + 1}`,
    };
  }

  const shutdownRes = (want: number | null): ReviewWaitRes => {
    const n = want ?? collectingN();
    const next = REVIEW_STDOUT.next.replace("{n}", String(n));
    return {
      status: "shutdown",
      approved: false,
      stdout: `mitori.review/1 round=${n} status=shutdown\n${REVIEW_STDOUT.shutdown}\n${next}\n`,
      next: next.slice("NEXT: ".length),
    };
  };

  function wake(): void {
    for (const w of [...waiting]) {
      const r = deliverable(w.want);
      if (r) {
        waiting.delete(w);
        deliver(r.round.n).then(w.done, () => w.done(shutdownRes(w.want)));
      }
    }
  }

  /* ---- completion ------------------------------------------------------------------------------------------ */
  function complete(rec: RoundRecord, human: boolean): Round {
    const n = rec.round.n;
    for (const id of rec.round.threads) {
      const t = store.thread(id)?.thread;
      if (!t || (t.state !== "running" && t.state !== "queued")) continue;
      save(fire(t, "cancel", human ? "human" : "system"));
      if (!human) addMessage_(id, "system", "system", `R${n} で返信なし`);
    }
    rec.round = { ...rec.round, state: human ? "withdrawn" : "complete", finishedAt: now() };
    putRound(rec);
    if (!human) emit(() => deps.domain.emit({ type: "round.completed", round: n, doneThreads: rec.done, files: rec.files }));
    return rec.round;
  }

  /* ---- the engine ------------------------------------------------------------------------------------------ */
  const engine: ReviewEngineHandle = {
    create(req, by) {
      return mutate(() => {
        const body = lf(req.body);
        if (!req.draft && body.trim() === "") throw new MitoriError("E_INVALID_INPUT", "a submitted thread needs a body");
        if (!req.draft && by !== "human") assertTransition({ machine: "thread", from: "draft", on: "submit", by: by === "system" ? "system" : "agent" });
        const cap = deps.captureAnchor(req.anchor, null);
        const at = now();
        const t: Thread = {
          id: newId("thread", deps.random),
          anchor: cap.anchor,
          anchorHealth: "ok",
          stale: false,
          intent: req.intent,
          state: req.draft ? "draft" : "open",
          round: req.draft ? collectingN() : ensureCollecting().round.n,
          version: 1,
          title: titleOf(body),
          jobs: [],
          createdAt: at,
          updatedAt: at,
        };
        if (t.intent === "note") t.sendToAi = false;
        store.insertThread(t, null);
        addMessage_(t.id, by, "comment", body);
        snapshot(t.id, cap, ["captured", "last_ok"], false);
        emit(() => deps.events.emit({ type: "thread.upsert", thread: summaryOf(t) }));
        return detailOf(t);
      });
    },

    patch(id, req) {
      return mutate(() => {
        let t = load(id);
        checkVersion(t, req.version);
        const draft = t.state === "draft";
        if (!draft && (req.body !== undefined || req.anchor !== undefined))
          throw new MitoriError("E_PRECONDITION", "only drafts take body/anchor changes (use reanchor)", { params: { id, state: t.state } });
        if (req.intent !== undefined && req.intent !== t.intent) {
          if (t.state === "queued" || t.state === "running")
            throw new MitoriError("E_PRECONDITION", "intent cannot change while a job runs", { params: { id, state: t.state } });
          t = { ...t, intent: req.intent };
          if (t.intent === "note") t.sendToAi = t.sendToAi ?? false;
          else delete t.sendToAi;
        }
        if (req.body !== undefined) {
          const first = store.firstMessage(id);
          const body = lf(req.body);
          if (first) store.updateMessageBody(first.id, body, null);
          t = { ...t, title: titleOf(body) };
        }
        if (req.anchor !== undefined) {
          const cap = deps.captureAnchor(req.anchor, t.anchor);
          t = { ...t, anchor: cap.anchor, anchorHealth: "ok" };
          snapshot(id, cap, ["captured", "last_ok"], true);
        }
        if (req.dismissStale) t = { ...t, stale: false };
        if (req.sendToAi !== undefined) {
          if (t.intent !== "note") throw new MitoriError("E_INVALID_INPUT", "sendToAi applies to note threads only", { params: { id } });
          t = { ...t, sendToAi: req.sendToAi };
        }
        return detailOf(save(t));
      });
    },

    remove(id) {
      mutate(() => {
        const t = load(id);
        if (t.state !== "draft") throw new MitoriError("E_PRECONDITION", "only drafts can be deleted", { params: { id, state: t.state } });
        store.deleteThread(id);
        emit(() => deps.events.emit({ type: "thread.removed", id }));
      });
    },

    addMessage(id, body, version) {
      return mutate(() => {
        let t = load(id);
        checkVersion(t, version);
        if (lf(body).trim() === "") throw new MitoriError("E_INVALID_INPUT", "empty message");
        addMessage_(id, "human", "comment", body);
        // A human reply hands the thread back to the next Finish (T16 / T20 / T22 / T18; spec §2.4.1).
        if (t.state === "answered" || t.state === "rejected" || t.state === "failed") t = fire(t, "reply", "human");
        else if (t.state === "needs_input") t = fire(t, "cancel", "human");
        return detailOf(save(t));
      });
    },

    transition(id, req, actor) {
      return mutate(() => {
        let t = load(id);
        checkVersion(t, req.version);
        assertTransition({ machine: "thread", from: t.state, on: req.on, by: actor });
        const resolution = req.on === "resolve" ? (req.resolution ?? DEFAULT_RESOLUTION[t.state]) : undefined;
        if (req.on === "resolve" && resolution === undefined)
          throw new MitoriError("E_INVALID_INPUT", "resolve needs a resolution", { params: { id, state: t.state } });
        if (req.on === "submit" && lf(store.firstMessage(id)?.body ?? "").trim() === "")
          throw new MitoriError("E_INVALID_INPUT", "a submitted thread needs a body");
        t = fire(t, req.on, actor, resolution);
        if (req.on === "submit") t.round = ensureCollecting().round.n;
        if (req.on === "resolve") store.closeProposals(id, t.resolution ?? null);
        if (req.message !== undefined && lf(req.message).trim() !== "") {
          addMessage_(id, actor === "human" ? "human" : actor === "system" ? "system" : "agent:pull", actor === "system" ? "system" : "comment", req.message);
        }
        return detailOf(save(t));
      });
    },

    reanchor(id, anchor, version) {
      return mutate(() => {
        const t = load(id);
        checkVersion(t, version);
        snapshot(id, { anchor }, ["last_ok"], true);
        return detailOf(save({ ...t, anchor, anchorHealth: "ok", stale: false }));
      });
    },

    applyReanchor(updates, ownThreads) {
      return mutate(() => {
        const own = new Set(ownThreads);
        const out = { moved: [] as ThreadId[], outdated: [] as ThreadId[], stale: [] as ThreadId[] };
        for (const u of updates) {
          const t = store.thread(u.thread)?.thread;
          if (!t || t.state === "draft") continue;
          const becomesStale =
            t.state !== "resolved" && !own.has(t.id) && (u.overlapped || u.blockRewritten || u.health === "fuzzy" || u.health === "outdated");
          const next: Thread = { ...t, anchor: u.anchor, anchorHealth: u.health, stale: t.stale || becomesStale };
          if (u.health === "moved") out.moved.push(t.id);
          if (u.health === "outdated") out.outdated.push(t.id);
          if (becomesStale) out.stale.push(t.id);
          if (u.health === "ok" || u.health === "moved") snapshot(t.id, { anchor: u.anchor }, ["last_ok"], true);
          if (JSON.stringify(next.anchor) !== JSON.stringify(t.anchor) || next.anchorHealth !== t.anchorHealth || next.stale !== t.stale) save(next);
        }
        return out;
      });
    },

    markStale(ranges, own) {
      return mutate(() => {
        const mine = new Set(own);
        const byPath = new Map<RepoPath, { start: number; end: number }[]>();
        for (const r of ranges) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);
        const marked: ThreadId[] = [];
        for (const [path, rs] of byPath) {
          for (const t of store.threads("WHERE primary_path = ? AND state NOT IN ('draft', 'resolved') AND stale = 0", [path])) {
            const c = t.anchor.code;
            if (mine.has(t.id) || !c || !rs.some((r) => r.start <= c.end && r.end >= c.start)) continue;
            save({ ...t, stale: true });
            marked.push(t.id);
          }
        }
        return marked;
      });
    },

    async estimateFinish(threads) {
      return (await estimate(targetsOf(threads, false))).est;
    },

    async finish(req) {
      const targets = targetsOf(req.threads, true);
      if (targets.length === 0) {
        const round = await deps.write("review.finish", () =>
          mutate(() => {
            const rec = ensureCollecting();
            rec.round = { ...rec.round, mode: req.mode, state: "complete", approved: true, finishedAt: now() };
            if (req.mode === "pull") rec.stdout = renderRound(rec.round.n, [], true);
            putRound(rec);
            return rec.round;
          }),
        );
        if (req.mode === "pull") wake();
        return { round, jobs: [] };
      }
      if (req.mode === "pull") {
        const round = await deps.write("review.finish", () =>
          mutate(() => {
            for (const prev of store.rounds("WHERE mode = 'pull' AND state = 'dispatched'", [])) complete(prev, false);
            const rec = ensureCollecting();
            const n = rec.round.n;
            const sorted = sortForPull(targets.map((t) => load(t.id)));
            const prevRounds = sorted.map((t) => ({ t, prev: t.batchRound }));
            const dispatched = sorted.map((t) => save({ ...fire(t, "dispatch", "human"), batchRound: n, round: n }));
            rec.round = { ...rec.round, mode: "pull", state: "dispatched", threads: dispatched.map((t) => t.id), approved: false };
            rec.stdout = renderRound(
              n,
              prevRounds.map((x, i) => ({ t: dispatched[i] as Thread, prev: x.prev })),
              false,
            );
            putRound(rec);
            ensureCollecting();
            return rec.round;
          }),
        );
        wake();
        return { round, jobs: [] };
      }
      // push: estimate (or reuse the confirmed one), confirm, dispatch, then one job per partition.
      const key = targets
        .map((t) => t.id)
        .sort()
        .join(",");
      const known = req.estimateId ? remembered.find((r) => r.est.estimateId === req.estimateId && r.key === key) : undefined;
      const est = known ?? (await estimate(targets));
      if (est.est.requiresConfirm && !(req.confirm === true && known !== undefined)) {
        throw new MitoriError("E_PRECONDITION", "Finish needs a confirmed estimate", {
          params: { estimate: est.est.batchTokens, estimateId: est.est.estimateId },
        });
      }
      const round = await deps.write("review.finish", () =>
        mutate(() => {
          const rec = ensureCollecting();
          const n = rec.round.n;
          for (const t of targets) save({ ...fire(load(t.id), "dispatch", "human"), batchRound: n, round: n });
          rec.round = { ...rec.round, mode: "push", state: "dispatched", threads: targets.map((t) => t.id), approved: false };
          putRound(rec);
          ensureCollecting();
          return rec.round;
        }),
      );
      const jobs: JobSummary[] = [];
      let failure: unknown = null;
      for (const [i, p] of est.est.partitions.entries()) {
        try {
          jobs.push(
            await deps.jobs().create({ kind: p.kind, threads: p.threads, estimateId: est.partitionIds[i] as EstimateId, confirm: req.confirm === true }),
          );
        } catch (e) {
          failure ??= e;
          const msg = MitoriError.from(e).code;
          await deps.write("review.finish.revert", () =>
            mutate(() => {
              for (const id of p.threads) {
                const t = store.thread(id)?.thread;
                if (t?.state !== "queued") continue;
                save(fire(t, "cancel", "system"));
                addMessage_(id, "system", "system", `R${round.n} のジョブを作成できませんでした（${msg}）`);
              }
            }),
          );
        }
      }
      if (jobs.length === 0 && failure !== null) throw failure;
      const res: FinishRes = { round, jobs };
      const saved = est.est.separateTokens - est.est.batchTokens;
      if (saved > 0) res.savedTokens = saved;
      return res;
    },

    withdrawRound(n) {
      return mutate(() => {
        const rec = store.round(n);
        if (!rec) throw new MitoriError("E_NOT_FOUND", `round ${n} not found`, { params: { round: n } });
        if (rec.round.state === "withdrawn" || rec.round.state === "complete") return rec.round;
        if (rec.round.mode !== "pull" || rec.round.state !== "dispatched")
          throw new MitoriError("E_PRECONDITION", "only a dispatched pull round can be withdrawn", { params: { round: n } });
        return complete(rec, true);
      });
    },

    async wait(round, timeoutMs, signal) {
      if (stopped || signal.aborted) return shutdownRes(round);
      const ready = deliverable(round);
      if (ready) return deliver(ready.round.n);
      return new Promise<ReviewWaitRes>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const w: Waiter = {
          want: round,
          done: (r) => {
            if (timer) clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            waiting.delete(w);
            resolve(r);
          },
        };
        const onAbort = () => w.done(shutdownRes(round));
        signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(
          () => w.done({ status: "timeout", approved: false, next: `mitori review --round ${round ?? collectingN()}` }),
          Math.max(0, timeoutMs),
        );
        waiting.add(w);
      });
    },

    completeRound(n) {
      return mutate(() => {
        const rec = store.round(n);
        if (!rec) throw new MitoriError("E_NOT_FOUND", `round ${n} not found`, { params: { round: n } });
        if (rec.round.mode !== "pull" || rec.round.state !== "dispatched") return rec.round;
        return complete(rec, false);
      });
    },

    reply(id, req, agent) {
      return mutate(() => {
        const body = lf(req.body);
        if (body.length > REPLY_MAX_CHARS)
          throw new MitoriError("E_PAYLOAD_TOO_LARGE", `reply over ${REPLY_MAX_CHARS} chars`, { params: { chars: body.length } });
        if (deps.secrets.scan(body).length > 0) throw new MitoriError("E_SECRET_DETECTED", "the reply contains a secret");
        const files: RepoPath[] = [];
        for (const f of req.files ?? []) {
          const p = parseRepoPath(f);
          if (!p.ok) throw MitoriError.from(p.error);
          files.push(p.value);
        }
        let t = load(id);
        const by: MessageAuthor = `agent:${agent}`;
        const trigger = AGENT_TRIGGER[req.kind];
        const rec = t.batchRound !== undefined ? store.round(t.batchRound) : null;
        const inPullRound = rec !== null && rec.round.mode === "pull" && rec.round.state === "dispatched" && rec.round.threads.includes(id);
        // Implicit dispatch (T2' → T3'): an open thread found outside a round, or a pull thread replied to before delivery.
        if (t.state === "open") t = fire(fire(t, "dispatch", "system"), "start", "agent");
        else if (t.state === "queued" && inPullRound) t = fire(t, "start", "agent");
        if (t.state === "running") t = fire(t, trigger, "agent");
        else if (!(inPullRound && (t.state === "answered" || t.state === "applied" || t.state === "needs_input")))
          assertTransition({ machine: "thread", from: t.state, on: trigger, by: "agent" });
        if (req.docUpdate) {
          const blockId = t.anchor.doc?.block;
          const block = blockId ? deps.doc.block(blockId) : null;
          if (!block) throw new MitoriError("E_INVALID_INPUT", "docUpdate needs a thread anchored on a doc block", { params: { id } });
          deps.doc.propose({
            block: block.id,
            section: block.section,
            op: "update",
            baseHash: block.hash,
            md: req.docUpdate,
            source: { kind: "agent_reply", id },
            reason: firstLine(body, 80),
          });
        }
        addMessage_(id, by, req.kind, body);
        if (rec && inPullRound) {
          if (files.length > 0) rec.files = [...new Set([...rec.files, ...files])].sort();
          if (req.kind === "done" && !rec.done.includes(id)) rec.done = [...rec.done, id];
          store.upsertRound(rec);
        }
        if (files.length > 0) emit(() => deps.domain.emit({ type: "files.touched", paths: files, source: "cli" }));
        return save(t);
      });
    },

    proposeResolution(id, req, agent) {
      mutate(() => {
        const t = load(id);
        if (t.state === "draft" || t.state === "resolved") throw new MitoriError("E_PRECONDITION", "nothing to resolve", { params: { id, state: t.state } });
        store.insertProposal(id, `agent:${agent}`, req.resolution, req.note ?? null, now());
        save(t);
      });
    },

    async promote(id, to, title) {
      return deps.write("review.promote", () =>
        mutate(() => {
          let t = load(id);
          const messages = store.messages(id);
          if (to === "doc") {
            const answer = [...messages].reverse().find((m) => m.kind === "answer");
            const block = t.anchor.doc ? deps.doc.block(t.anchor.doc.block) : null;
            if (t.state !== "answered" || !answer || !block)
              throw new MitoriError("E_PRECONDITION", "promote to doc needs an answered thread on a doc block", { params: { id, state: t.state } });
            const md = answer.body.replace(/\[\[([^\]:]+):(\d+)-(\d+)\]\]/g, (_, p: string, a: string, b: string) => `[${p}:${a}-${b}](${p}#L${a}-L${b})`);
            const p = deps.doc.propose({
              block: null,
              section: block.section,
              after: block.id,
              op: "insert",
              baseHash: null,
              md,
              source: { kind: "answer_promote", id },
              reason: `${t.intent === "question" ? "faq" : "deepdive"}: ${t.title}`,
            });
            t = fire(t, "resolve", "human", "promoted");
            store.closeProposals(id, "promoted");
            save(t);
            return { proposal: p.id as ProposalId };
          }
          if (t.state !== "resolved") {
            if (!RESOLVABLE.includes(t.state)) throw new MitoriError("E_PRECONDITION", "thread cannot be resolved yet", { params: { id, state: t.state } });
            t = fire(t, "resolve", "human", "promoted");
            store.closeProposals(id, "promoted");
            t = save(t);
          }
          const decision = buildDecision(t, messages, title);
          return { decision: deps.doc.writeDecision(decision.d, deps.secrets.redact(decision.md).text) };
        }),
      );
    },

    async docEditToCode(block, req) {
      const b = deps.doc.block(block);
      if (!b) throw new MitoriError("E_NOT_FOUND", `block ${block} not found`, { params: { block } });
      if (req.baseHash !== b.hash) throw new MitoriError("E_DOC_BASE_MISMATCH", "the block changed since the edit started", { params: { block } });
      const thread = await deps.write("review.docEdit", () =>
        mutate(() => {
          const cap = deps.captureAnchor({ primary: "doc", doc: { block, selStart: 0, selEnd: 0 } }, null);
          const body = renderDocEditAsk(b.md, req.md);
          const at = now();
          const t: Thread = {
            id: newId("thread", deps.random),
            anchor: cap.anchor,
            anchorHealth: "ok",
            stale: false,
            intent: "doc_edit",
            state: "draft",
            round: collectingN(),
            version: 1,
            title: titleOf(body),
            jobs: [],
            createdAt: at,
            updatedAt: at,
          };
          store.insertThread(t, lf(req.md));
          addMessage_(t.id, "human", "comment", body);
          snapshot(t.id, cap, ["captured", "last_ok"], false);
          if (deps.partition.writeScopeOf(detailOf(t)).length === 0)
            throw new MitoriError("E_PRECONDITION", "no code to change: mention the target code with @", { params: { block } });
          emit(() => deps.events.emit({ type: "thread.upsert", thread: summaryOf(t) }));
          return t;
        }),
      );
      const estimate = await deps.jobs().estimate({ kind: "fix", threads: [thread.id] });
      const res: DocEditRes = { estimate };
      const s = summaryOf(load(thread.id));
      res.thread = s;
      return res;
    },

    inbox(filter) {
      const items: InboxItem[] = [];
      for (const t of store.threads("ORDER BY updated_at DESC, id DESC", [])) {
        const tags = inboxTags(t);
        if (tags === null || (filter !== null && filter !== "all" && !tags.includes(filter))) continue;
        const item: InboxItem = {
          kind: "thread",
          id: t.id,
          title: t.title,
          state: t.state,
          displayState: displayState(t),
          tags,
          intent: t.intent,
          thread: t.id,
          updatedAt: t.updatedAt,
          href: HREFS.thread(deps.ws.key, t.id),
        };
        const anchor: NonNullable<InboxItem["anchor"]> = {};
        const sec = t.anchor.doc ? sectionOf(t.anchor.doc.block) : null;
        if (sec) anchor.section = sec;
        if (t.anchor.code) {
          anchor.path = t.anchor.code.path;
          anchor.line = t.anchor.code.start;
        }
        if (Object.keys(anchor).length > 0) item.anchor = anchor;
        items.push(item);
      }
      return items;
    },

    list(q) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (q.states && q.states.length > 0) {
        where.push(`state IN (${q.states.map(() => "?").join(", ")})`);
        params.push(...q.states);
      }
      if (q.intent) {
        where.push("intent = ?");
        params.push(q.intent);
      }
      if (q.block) {
        where.push("primary_block = ?");
        params.push(q.block);
      }
      if (q.path) {
        where.push("primary_path = ?");
        params.push(q.path);
      }
      const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
      const offset = q.cursor ? Math.max(0, Number.parseInt(q.cursor, 10) || 0) : 0;
      const items = store.threads(`${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`, [
        ...params,
        limit + 1,
        offset,
      ]);
      const more = items.length > limit;
      return { items: more ? items.slice(0, limit) : items, next: more ? String(offset + limit) : null };
    },

    get(id) {
      const r = store.thread(id);
      return r ? detailOf(r.thread) : null;
    },

    status() {
      const open = store.threads("WHERE state = 'open' ORDER BY created_at, id", []);
      const round = collecting()?.round ?? store.rounds("ORDER BY n DESC LIMIT 1", [])[0]?.round ?? null;
      return {
        round,
        pending: open.filter(sendable).map((t) => t.id),
        heldNotes: open.filter((t) => t.intent === "note" && t.sendToAi !== true).map((t) => t.id),
        waitingClients: waiting.size,
        waitingAgents: [],
      };
    },

    waiters: () => waiting.size,

    shutdown() {
      stopped = true;
      for (const w of [...waiting]) w.done(shutdownRes(w.want));
    },

    snapshots: (id) => store.snapshots(id),

    summary(id) {
      const r = store.thread(id);
      return r ? summaryOf(r.thread) : null;
    },
  };

  function inboxTags(t: Thread): InboxFilter[] | null {
    const tags: InboxFilter[] = ["all"];
    if (t.state === "draft") {
      if (lf(store.firstMessage(t.id)?.body ?? "").trim() === "") return null;
      tags.push("draft");
      return tags;
    }
    const ds = displayState(t);
    if (t.state === "queued" || t.state === "running") tags.push("working");
    if (t.state === "proposed") tags.push("review");
    if (t.state === "failed") tags.push("failed");
    if (t.state === "resolved") tags.push("resolved");
    const outdated = ds === "outdated" || (t.stale && t.state !== "resolved");
    if (outdated) tags.push("outdated");
    if (
      t.state === "answered" ||
      t.state === "needs_input" ||
      t.state === "proposed" ||
      t.state === "failed" ||
      (outdated && t.state !== "resolved") ||
      store.hasPendingProposal(t.id)
    )
      tags.push("mine");
    return tags;
  }

  function buildDecision(t: Thread, messages: Message[], title?: string): { d: Decision; md: string } {
    const d: Decision = {
      id: newId("decision", deps.random),
      title: title ?? t.title,
      status: "accepted",
      thread: t.id,
      blocks: [],
      cites: [],
      file: "",
      decidedAt: now(),
    };
    d.file = `decisions/${d.id}.md`;
    const docBlock = t.anchor.doc ? deps.doc.block(t.anchor.doc.block) : null;
    if (docBlock) d.blocks.push(docBlock.id);
    const c = t.anchor.code;
    // CR-PENDING(WP-07): answer cites carry no blob/snippet, so only the code member becomes a Cite.
    if (c) {
      const cite: Decision["cites"][number] = { path: c.path, start: c.start, end: c.end, blob: c.blob, snippet: c.snippet, precision: "exact" };
      if (c.symbol) cite.symbol = c.symbol;
      d.cites.push(cite);
    }
    const human = messages.filter((m) => m.by === "human");
    const agentFinal = [...messages].reverse().find((m) => m.by.startsWith("agent:") && (m.kind === "answer" || m.kind === "proposal" || m.kind === "done"));
    const up = deps.ws.docDir.startsWith("/") ? "" : "../".repeat(deps.ws.docDir.split("/").filter(Boolean).length + 1);
    const section = docBlock ? deps.doc.sections().find((s) => s.id === docBlock.section) : undefined;
    const md = renderDecisionMarkdown(d, {
      context: human[0]?.body ?? "",
      decision: agentFinal?.body ?? human[human.length - 1]?.body ?? "",
      discussion: messages.filter((m) => m.kind !== "system"),
      docLinks: docBlock ? [{ label: `§${docBlock.section}${section ? ` ${section.title}` : ""}`, href: `../${docBlock.file}#${docBlock.id}` }] : [],
      codeLinks: c ? [{ label: `${c.path}:${c.start}-${c.end}`, href: `${up}${c.path}#L${c.start}-L${c.end}` }] : [],
    });
    return { d, md };
  }

  return engine;
}
