/**
 * The review-loop controller of the web UI (WP-10b): ONE instance per store root, created by `install` (threads/ui.ts)
 * and shared by the margin, the Review panel, the Inbox and the overlays. It builds on WP-10a's `ReviewState` (threads,
 * jobs, events — fed by SSE) and adds what the loop UI needs: the open Composer, optimistic cards (ux.md §6.4: the
 * card is on screen ≤ 100 ms after ⌘⏎, before any request returns), messages, the `mitori review` waiters, trust
 * requests, checkpoints, the undo model and the Finish / trust / conflict dialogs.
 */

import type { ApiCallError } from "@mitori/client";
import {
  type AcceptReq,
  type Anchor,
  type AnchorInput,
  type BlockId,
  type Checkpoint,
  type CheckpointId,
  type DocProposalView,
  INTENT_JOB_KIND,
  type InboxItem,
  type JobEstimate,
  type JobId,
  type JobSummary,
  type MessageView,
  MitoriError,
  type ReviewStatus,
  type ThreadDetail,
  type ThreadId,
  type ThreadIntent,
  type ThreadSummary,
  type TrustItemId,
  type TrustRequest,
  type WorkspaceKey,
} from "@mitori/core";
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { contextAdjust } from "../composer/predict.ts";
import { ComposerSession, type ComposerTarget } from "../composer/session.svelte.ts";
import { targetOfBlock } from "../composer/targets.ts";
import type { ExecPath, StageRow } from "../contract.ts";
import { projectJob, projectProposal, projectThread, projectTrust, removeRow, upsertRow } from "../inbox/project.ts";
import { gateLabel } from "../jobs/gates.ts";
import { planStages } from "../jobs/index.ts";
import { UndoManager } from "../review/undo.svelte.ts";
import { copyText } from "../shell/clipboard.ts";
import { errorText, t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { getItem, setItem } from "../shell/storage.ts";
import type { Stores } from "../stores/app.svelte.ts";

/** A submitted Composer whose job is not on the wire yet (or waits for a confirmation / a retry). */
export interface Pending {
  /** Map key: the Composer's temp key, kept for the life of the card. */
  key: string;
  thread: ThreadId | null;
  job: JobId | null;
  intent: ThreadIntent;
  body: string;
  block: BlockId;
  quote: string;
  rows: StageRow[];
  mode: JobEstimate["route"]["mode"];
  model: string;
  /** Date.now() at ⌘⏎ (elapsed column). */
  t0: number;
  /** ⌘⏎ → card painted (the 受付 row's 「楽観的に作成 · {ms}ms」). */
  acceptMs: number | null;
  phase: "sending" | "confirm" | "error";
  estimate: JobEstimate | null;
  error: string | null;
  /** The Composer it came from: retry / 「範囲を絞る」 reopen it with the text and chips kept (AC-J39). */
  session: ComposerSession;
}

export type LoopDialog = { kind: "conflict"; job: JobId; files: string[] } | { kind: "confirmEscalate"; job: JobId; estimate: JobEstimate } | null;

const EXEC_PATH_KEY = (ws: string) => `mitori:execPath:${ws}`;
const RUNNING: ReadonlySet<JobSummary["state"]> = new Set(["queued", "waiting_lock", "preparing", "running", "gating", "repairing"]);

const byStores = new WeakMap<object, Loop>();

/** The loop of a store root (created on first use). */
export function loopOf(s: Stores): Loop {
  let l = byStores.get(s);
  if (!l) {
    l = new Loop(s);
    byStores.set(s, l);
  }
  return l;
}

export class Loop {
  readonly s: Stores;
  readonly undo: UndoManager;
  composer = $state.raw<ComposerSession | null>(null);
  pending = new SvelteMap<string, Pending>();
  messages = new SvelteMap<ThreadId, readonly MessageView[]>();
  waiting = $state.raw<{ round: number; clients: number; agents: readonly string[] } | null>(null);
  trust = new SvelteMap<TrustItemId, TrustRequest>();
  checkpoints = new SvelteMap<CheckpointId, Checkpoint>();
  finishOpen = $state(false);
  trustOpen = $state.raw<TrustRequest | null>(null);
  dialog = $state.raw<LoopDialog>(null);
  hideResolved = $state(false);
  /** Thread being re-anchored (Inbox 「新しい位置を指定」): the next selection offers 「ここに付け直す」. */
  reanchoring = $state<ThreadId | null>(null);
  /** Card focused by `[` / `]` / the job popover. */
  active = $state<string | null>(null);
  /** Blocks updated by an accept (flash once, focus the first). */
  flashed = $state.raw<readonly BlockId[]>([]);
  /** Jobs whose accept call is in flight (the button says 「採用中…」 in place). */
  accepting = new SvelteMap<JobId, boolean>();
  /** Last estimate (in + out tokens) per block: the selection toolbar's `≈{k}` (only when cached). */
  estimateHint = new SvelteMap<BlockId, number>();
  /** A doc proposal exists in this workspace (the in-prose proposal layer is loaded from then on). */
  proposalsSeen = $state(false);
  /** Bumped on every Review decision (the decision Maps of `ReviewStore.decisions` are plain Maps). */
  decisionTick = $state(0);
  /** When a key acted on the live selection (the Reader's own handler of the same key is then ignored). */
  selectionClaim = 0;
  #ws: WorkspaceKey | null = null;
  #installed = false;

  constructor(s: Stores) {
    this.s = s;
    this.undo = new UndoManager(s);
    this.undo.onUndone = () => void this.refreshReview();
  }

  get ws(): WorkspaceKey | null {
    return this.s.workspace.key;
  }

  // =============================================================================== install (once per store root)
  install(): void {
    if (this.#installed) return;
    this.#installed = true;
    const s = this.s;
    const sse = s.sse;
    sse.on("thread.message", (e) => this.#onMessage(e.message));
    sse.on("thread.upsert", (e) => this.#onThread(e.thread));
    sse.on("thread.removed", (e) => this.#inbox((items) => removeRow(items, e.id)));
    sse.on("job.upsert", (e) => this.#onJob(e.job));
    sse.on("review.waiting", (e) => (this.waiting = { round: e.round, clients: e.clients, agents: e.agents }));
    sse.on("review.round", () => void this.refreshReview());
    sse.on("trust.request", (e) => this.#onTrust(e.request));
    sse.on("checkpoint.upsert", (e) => this.checkpoints.set(e.checkpoint.id, e.checkpoint));
    sse.on("doc.proposal.upsert", (e) => this.#onProposal(e.proposal));
    sse.on("doc.proposal.removed", (e) => this.#inbox((items) => removeRow(items, e.id)));
    sse.on("resync", () => void this.#enter(this.ws, true));
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => void this.undo.flush());
      // the Reader's hand-off: focused block / claim popover / gutter (`c` `e` `f`)
      window.addEventListener("mitori:compose", (ev) => {
        if (Date.now() - this.selectionClaim < 250) return;
        const d = (ev as CustomEvent<{ block: BlockId; claim: string | null; intent: ThreadIntent }>).detail;
        const target = targetOfBlock(s, d.block, d.claim);
        if (target) void this.openComposer(target, d.intent, ev.timeStamp);
      });
    }
    $effect.root(() => {
      $effect(() => {
        const ws = s.workspace.key;
        untrack(() => void this.#enter(ws));
      });
    });
  }

  async #enter(ws: WorkspaceKey | null, force = false): Promise<void> {
    if (ws === this.#ws && !force) return;
    if (ws !== this.#ws) {
      await this.undo.flush();
      this.closeComposer();
      this.pending.clear();
      this.messages.clear();
      this.trust.clear();
      this.checkpoints.clear();
      this.waiting = null;
    }
    this.#ws = ws;
    if (!ws) return;
    const [rv, tr, ck, pp] = await Promise.allSettled([
      this.s.api.call("GET /ws/:ws/review", { params: { ws } }),
      this.s.api.call("GET /ws/:ws/trust", { params: { ws } }),
      this.s.api.call("GET /ws/:ws/checkpoints", { params: { ws } }),
      this.s.api.call("GET /ws/:ws/doc/proposals", { params: { ws }, query: { state: "pending" } }),
    ]);
    if (this.ws !== ws) return;
    if (rv.status === "fulfilled") this.#applyReview(rv.value);
    if (tr.status === "fulfilled") for (const r of tr.value) this.trust.set(r.id, r);
    if (ck.status === "fulfilled") for (const c of ck.value) this.checkpoints.set(c.id, c);
    // pending proposals of earlier sessions (SSE only brings the new ones)
    if (pp.status === "fulfilled" && pp.value.length) {
      for (const p of pp.value) this.s.doc.upsertProposal(p);
      this.proposalsSeen = true;
    }
  }

  async refreshReview(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const v = await this.s.api.call("GET /ws/:ws/review", { params: { ws } });
      if (this.ws === ws) this.#applyReview(v);
    } catch {
      /* the round line keeps its last value */
    }
  }

  #applyReview(v: ReviewStatus): void {
    this.s.review.round = v;
    this.waiting = { round: (v.round?.n ?? 0) + (v.round?.state === "collecting" ? 0 : 1), clients: v.waitingClients, agents: v.waitingAgents };
  }

  // =============================================================================== SSE
  #inbox(fn: (items: readonly InboxItem[]) => InboxItem[]): void {
    if (!this.s.inbox.loaded) return;
    this.s.inbox.items = fn(this.s.inbox.items);
  }

  #onMessage(m: MessageView): void {
    const cur = this.messages.get(m.thread) ?? [];
    if (cur.some((x) => x.id === m.id)) return;
    this.messages.set(m.thread, [...cur, m]);
  }

  #onThread(th: ThreadSummary): void {
    const ws = this.ws;
    if (!ws) return;
    // the optimistic temp entry gives way to the server's thread
    for (const p of this.pending.values()) {
      if (p.thread === th.id) this.s.review.threads.delete(p.key);
    }
    const block = th.anchor.doc?.block;
    const section = block ? this.s.doc.index?.blockSection.get(block) : undefined;
    this.#inbox((items) =>
      upsertRow(
        items,
        projectThread(
          items.find((x) => x.id === th.id),
          th,
          ws,
          section,
        ),
      ),
    );
  }

  #onJob(j: JobSummary): void {
    const ws = this.ws;
    if (!ws) return;
    for (const [k, p] of this.pending) if (p.job === j.id) this.pending.delete(k);
    const th = j.threads[0] ? this.s.review.threads.get(j.threads[0]) : undefined;
    this.#inbox((items) =>
      upsertRow(
        items,
        projectJob(
          items.find((x) => x.id === j.id),
          j,
          ws,
          th?.title ?? "",
          th?.intent,
        ),
      ),
    );
    if (j.state === "done" || j.state === "failed") for (const id of j.threads) void this.loadThread(id);
  }

  #onTrust(r: TrustRequest): void {
    this.trust.set(r.id, r);
    this.#inbox((items) =>
      upsertRow(
        items,
        projectTrust(
          items.find((x) => x.id === r.id),
          r,
          new Date().toISOString(),
        ),
      ),
    );
    if (r.status === "pending") {
      const n = [...this.trust.values()].filter((x) => x.status === "pending").length;
      this.s.bottom.toast({
        id: "trust.pending",
        kind: "warn",
        key: "trust.toast.pending",
        params: { n },
        action: { key: "trust.action.review", run: () => (this.trustOpen = r) },
      });
    }
  }

  #onProposal(p: DocProposalView): void {
    if (p.state === "pending") this.proposalsSeen = true;
    const ws = this.ws;
    if (ws)
      this.#inbox((items) =>
        upsertRow(
          items,
          projectProposal(
            items.find((x) => x.id === p.id),
            p,
            ws,
          ),
        ),
      );
  }

  /** Messages of a thread (detail fetch; SSE appends afterwards). */
  async loadThread(th: ThreadId): Promise<ThreadDetail | null> {
    const ws = this.ws;
    if (!ws || th.startsWith("tmp_")) return null;
    try {
      const d = await this.s.review.detail(th);
      this.messages.set(th, d.messages);
      return d;
    } catch {
      return null;
    }
  }

  // =============================================================================== queries
  /** Latest job of a thread. */
  jobOf(th: string): JobSummary | null {
    let best: JobSummary | null = null;
    for (const j of this.s.review.jobs.values()) {
      if (!j.threads.includes(th as ThreadId)) continue;
      if (!best || j.createdAt > best.createdAt) best = j;
    }
    return best;
  }

  pendingOf(th: string): Pending | null {
    for (const p of this.pending.values()) if (p.key === th || p.thread === th) return p;
    return null;
  }

  isRunning(j: JobSummary | null): boolean {
    return !!j && RUNNING.has(j.state);
  }

  /** Threads that `⇧F` would send (server list; the open notes are held unless `sendToAi`). */
  get pendingThreads(): readonly ThreadId[] {
    return this.s.review.round?.pending ?? [...this.s.review.threads.values()].filter((t) => t.state === "open" && t.intent !== "note").map((t) => t.id);
  }

  readyJobs(): JobSummary[] {
    return [...this.s.review.jobs.values()]
      .filter((j) => j.state === "ready" && !this.s.review.pendingRejects.has(j.id))
      .sort((a, b) => ((a.finishedAt ?? a.createdAt) < (b.finishedAt ?? b.createdAt) ? -1 : 1));
  }

  // =============================================================================== Composer
  execPath(): ExecPath {
    const ws = this.ws;
    const last = ws ? getItem("local", EXEC_PATH_KEY(ws)) : null;
    if (last === "push" || last === "pull" || last === "copy") return last;
    return this.s.session.settings?.settings.ui.defaultExecPath ?? "push";
  }

  rememberPath(p: ExecPath): void {
    const ws = this.ws;
    if (ws) setItem("local", EXEC_PATH_KEY(ws), p);
  }

  /**
   * Open the Composer on `target` (`c` note, `e` question, `f` change). The same anchor reopened keeps its
   * intent and its draft (WCAG 3.3.7); another open Composer is closed first (its draft is kept).
   */
  async openComposer(target: ComposerTarget, intent: ThreadIntent, trigger?: number, range?: Range): Promise<ComposerSession> {
    const cur = this.composer;
    if (cur && cur.target.key === target.key) {
      cur.setIntent(intent);
      return cur;
    }
    if (cur) this.closeComposer();
    // a text selection stays painted while its Composer is open; a whole-block anchor has no highlight
    if (range) this.highlight(range);
    const session = new ComposerSession(this.s, target, intent, this.execPath());
    this.composer = session;
    this.active = session.tempKey;
    markAfterPaint("mitori:composer:opened", trigger !== undefined ? { trigger } : undefined);
    // a draft on the same quote: resume it — its intent and its body verbatim (WCAG 3.3.7)
    const draft = [...this.s.review.threads.values()].find(
      (x) =>
        x.state === "draft" &&
        x.intent !== "doc_edit" &&
        x.anchor.doc?.block === target.block &&
        x.anchor.doc?.quote?.exact === target.anchor.doc?.quote?.exact,
    );
    if (draft) {
      const d = await this.loadThread(draft.id);
      if (d && this.composer === session && !session.body) {
        session.resume(d);
        void session.refreshEstimate();
      }
    }
    return session;
  }

  /** Escape / 閉じる: the draft is kept (no confirmation, IME_RULES.confirmOnDiscard = false). */
  closeComposer(): void {
    const c = this.composer;
    if (!c) return;
    this.composer = null;
    this.#noteHint(c);
    this.clearHighlight();
    if (c.fixTarget === "doc" && c.docChanged) void this.#holdDocEdit(c);
    else if (c.draft || c.body.trim()) void c.flushSave();
    c.dispose();
    if (this.active === c.tempKey) this.active = null;
  }

  #noteHint(c: ComposerSession): void {
    const p = c.predicted;
    if (c.estimate) this.estimateHint.set(c.target.block, p.tokensIn + p.tokensOut);
  }

  /** Paint the anchored selection while its Composer is open (`::highlight(mitori-sel)`, no DOM split). */
  highlight(range: Range): void {
    const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (H && reg) reg.set("mitori-sel", new H(range.cloneRange()));
  }

  clearHighlight(): void {
    (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete("mitori-sel");
  }

  /** Closed without choosing: the edited Markdown waits in Inbox as 「要選択」 (doc_edit draft, ux.md §5.5). */
  async #holdDocEdit(c: ComposerSession): Promise<void> {
    const ws = this.ws;
    if (!ws || c.docMd === undefined) return;
    try {
      const th = await this.s.api.call("POST /ws/:ws/threads", {
        params: { ws },
        body: { anchor: c.target.anchor, intent: "doc_edit", body: c.docMd, draft: true },
      });
      this.s.review.threads.set(th.id, { ...th, preview: c.docMd.slice(0, 120), messages: 1 });
      if (c.draft) await this.s.api.call("DELETE /ws/:ws/threads/:th", { params: { ws, th: c.draft } }).catch(() => {});
    } catch {
      /* the edit stays in the closed Composer's memory only */
    }
  }

  // =============================================================================== submit (⌘⏎) — ux.md §5.2 B5
  async submit(c: ComposerSession, trigger?: number): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    if (c.intent === "change" && c.fixTarget === "doc") {
      await this.saveDocEdit(c);
      return;
    }
    const body = c.body.trim() ? c.body : c.intent === "question" ? t("composer.defaultAsk.question") : c.body;
    if (!body.trim() && c.intent !== "question") return;
    this.rememberPath(c.path);
    const runs = c.intent !== "note" && c.path === "push";
    const key = c.tempKey;
    const now = new Date().toISOString();
    // 1. the optimistic card, before any request
    const tmp: ThreadSummary = {
      id: key as ThreadId,
      anchor: {
        primary: "doc",
        doc: { block: c.target.block, blockHash: c.target.blockHash, ...(c.target.anchor.doc?.quote ? { quote: c.target.anchor.doc.quote } : {}) },
      },
      anchorHealth: "ok",
      stale: false,
      intent: c.intent,
      state: runs ? "queued" : "open",
      round: this.s.review.round?.round?.n ?? 1,
      version: 0,
      title: body.split("\n")[0]?.slice(0, 60) ?? "",
      jobs: [],
      createdAt: now,
      updatedAt: now,
      preview: body.slice(0, 120),
      messages: 1,
    };
    this.s.review.threads.set(key, tmp);
    let p: Pending | null = null;
    if (runs) {
      const pred = c.predicted;
      const route = c.estimate?.route ?? {
        mode: pred.mode,
        reason: pred.reason ?? "small_change",
        model: c.estimate?.estimate.model ?? "claude-sonnet-5-5",
        effort: "medium",
        tools: pred.mode === "agent" ? "read_edit" : "none",
        contract: pred.mode === "answer" ? "answer/1" : pred.mode === "patch" ? "patch/1" : "agent/1",
        anchoredLines: pred.lines,
        files: pred.files,
        requiresConfirm: false,
      };
      p = {
        key,
        thread: c.draft,
        job: null,
        intent: c.intent,
        body,
        block: c.target.block,
        quote: c.target.quote.mark,
        rows: planStages(route, this.#gatesFor(route.mode)),
        mode: route.mode,
        model: route.model,
        t0: Date.now(),
        acceptMs: null,
        phase: "sending",
        estimate: c.estimate ?? null,
        error: null,
        session: c,
      };
      this.pending.set(key, p);
    }
    this.composer = null;
    this.#noteHint(c);
    this.clearHighlight();
    this.active = key;
    c.dispose();
    const t0 = performance.now();
    requestAnimationFrame(() => {
      const at = performance.now();
      if (p) this.#patchPending(key, { acceptMs: Math.round(at - (trigger ?? t0)) });
      markAfterPaint("mitori:card:optimistic", trigger !== undefined ? { trigger } : undefined);
    });
    // 2. the thread (submit the draft, or create it already open)
    let th: ThreadDetail;
    try {
      th = await this.#submitThread(c, body);
    } catch (err) {
      this.#failSubmit(key, c, err);
      return;
    }
    this.s.review.threads.delete(key);
    this.s.review.threads.set(th.id, { ...th, preview: body.slice(0, 120), messages: th.messages.length || 1 });
    this.messages.set(th.id, th.messages);
    if (p) this.#patchPending(key, { thread: th.id });
    this.active = th.id;
    if (c.intent === "note" || c.path === "pull") {
      if (c.path === "pull" && c.intent !== "note")
        this.s.bottom.toast({ id: "loop.pull", kind: "info", key: "composer.toast.pull", params: { n: this.waiting?.clients ?? 0 } });
      void this.refreshReview();
      return;
    }
    if (c.path === "copy") {
      await this.copyPrompt(th.anchor, body, c.intent);
      return;
    }
    // 3. estimate (fresh) → job
    await this.#startJob(key, c, th.id);
  }

  async #submitThread(c: ComposerSession, body: string): Promise<ThreadDetail> {
    const ws = this.ws as WorkspaceKey;
    const id = c.draft ?? (c.body.trim() ? await c.flushSave() : null);
    if (!id) {
      return this.s.api.call("POST /ws/:ws/threads", {
        params: { ws },
        body: { anchor: c.target.anchor, intent: c.intent, body, draft: false },
        idempotencyKey: `${c.tempKey}:submit`,
      });
    }
    if (body !== c.body || c.stale) {
      const saved = await this.s.api.call("PATCH /ws/:ws/threads/:th", { params: { ws, th: id }, body: { version: c.version, body, intent: c.intent } });
      c.version = saved.version;
    } else await c.flushSave();
    return this.s.api.call("POST /ws/:ws/threads/:th/transition", { params: { ws, th: id }, body: { on: "submit", version: c.version } });
  }

  async #startJob(key: string, c: ComposerSession, th: ThreadId, confirm = false): Promise<void> {
    const ws = this.ws as WorkspaceKey;
    try {
      let est = c.estimate && !c.stale && c.draft === th ? c.estimate : null;
      if (!est || confirm) {
        if (!c.draft) c.draft = th;
        est = (await c.refreshEstimate()) ?? null;
      }
      if (!est) throw new MitoriError("E_PRECONDITION", "no estimate");
      this.#patchPending(key, { estimate: est, rows: planStages(est.route, this.#gatesFor(est.route.mode)), mode: est.route.mode, model: est.route.model });
      if ((est.estimate.requiresConfirm || est.route.requiresConfirm) && !confirm) {
        this.#patchPending(key, { phase: "confirm" });
        return;
      }
      const context = contextAdjust(c.chips, c.candidateKeys, c.mentions);
      const job = await this.s.api.call("POST /ws/:ws/jobs", {
        params: { ws },
        body: {
          kind: INTENT_JOB_KIND[c.intent],
          threads: [th],
          estimateId: est.estimate.id,
          ...(Object.keys(context).length ? { context } : {}),
          ...(c.override?.mode ? { mode: c.override.mode } : {}),
          ...(c.override?.model ? { model: c.override.model } : {}),
          ...(confirm ? { confirm: true } : {}),
        },
        idempotencyKey: `${key}:job`,
      });
      this.#patchPending(key, { job: job.id });
      if (!this.s.review.jobs.has(job.id)) this.s.review.jobs.set(job.id, job);
      this.#onJob(job);
    } catch (err) {
      const fresh = (err as ApiCallError).estimate;
      if (MitoriError.from(err).code === "E_CONFLICT" && fresh && "route" in fresh) {
        c.applyEstimate(fresh);
        this.#patchPending(key, { estimate: fresh, phase: "confirm" });
        return;
      }
      this.#failSubmit(key, c, err);
    }
  }

  /** 「実行 ⌘⏎」 on a card in the confirm form. */
  confirm(key: string): void {
    const p = this.pending.get(key);
    if (!p?.thread) return;
    this.#patchPending(key, { phase: "sending" });
    void this.#startJob(key, p.session, p.thread, true);
  }

  /** 「再試行」 on a failed submit: the same Composer, text and chips intact (AC-J39). */
  retrySubmit(key: string): void {
    const p = this.pending.get(key);
    if (!p) return;
    if (p.thread) {
      this.#patchPending(key, { phase: "sending", error: null });
      void this.#startJob(key, p.session, p.thread);
      return;
    }
    this.pending.delete(key);
    this.s.review.threads.delete(key);
    this.composer = p.session;
  }

  /** 「範囲を絞る」: reopen the Composer with every removable chip available to remove. */
  narrow(key: string): void {
    const p = this.pending.get(key);
    if (!p) return;
    this.pending.delete(key);
    if (p.thread === null) this.s.review.threads.delete(key);
    p.session.details = true;
    this.composer = p.session;
  }

  #failSubmit(key: string, c: ComposerSession, err: unknown): void {
    const msg = errorText(MitoriError.from(err).toData());
    if (this.pending.has(key)) this.#patchPending(key, { phase: "error", error: msg });
    else {
      // a note / pull / copy that could not be sent: back to the Composer with the text (AC-J39)
      this.s.review.threads.delete(key);
      c.error = MitoriError.from(err).code;
      this.composer = c;
      this.s.bottom.toast({ id: "loop.submit", kind: "error", key: "composer.toast.sendFailed", params: { error: msg } });
    }
  }

  #patchPending(key: string, patch: Partial<Pending>): void {
    const cur = this.pending.get(key);
    if (cur) this.pending.set(key, { ...cur, ...patch });
  }

  /** Planned gate rows: the trusted gates (the server's estimate does not list them; the job's gates replace). */
  #gatesFor(mode: string): { id: string; label: string }[] {
    if (mode === "answer") return [];
    const fromJobs = new Map<string, string>();
    for (const j of this.s.review.jobs.values()) for (const g of j.gates) if (g.status !== "untrusted") fromJobs.set(g.gate, gateLabel(g.gate));
    return [...fromJobs].map(([id, label]) => ({ id, label }));
  }

  // =============================================================================== doc edit (apply doc) — ux.md §5.5
  /** Save the edited Markdown as the doc (L1-checked, locked human-edited). `dropped` ⇒ ask first (UXP-20). */
  async saveDocEdit(c: ComposerSession, confirmDrop = false): Promise<"saved" | "dropped" | "conflict" | "error"> {
    const ws = this.ws;
    if (!ws || c.docMd === undefined || !c.docBase) return "error";
    try {
      const res = await this.s.api.call("POST /ws/:ws/doc/blocks/:block/edit", {
        params: { ws, block: c.target.block },
        body: { baseHash: c.docBase.hash, md: c.docMd, mdForm: "file", apply: "doc", ...(confirmDrop ? { confirmDrop: true } : {}) },
      });
      if (res.dropped?.length && !confirmDrop) {
        c.dropped = res.dropped;
        return "dropped";
      }
      if (res.block) this.s.doc.upsertBlock(res.block);
      this.undo.docEdited(c.target.block, 0, c.docBase.md);
      if (c.draft) await this.s.api.call("DELETE /ws/:ws/threads/:th", { params: { ws, th: c.draft } }).catch(() => {});
      c.dispose();
      if (this.composer === c) this.composer = null;
      this.flash([c.target.block]);
      return "saved";
    } catch (err) {
      const e = MitoriError.from(err);
      if (e.code === "E_DOC_BASE_MISMATCH") {
        const fresh = await this.s.api
          .call("GET /ws/:ws/doc/blocks/:block", { params: { ws, block: c.target.block }, query: { md: "file" } })
          .catch(() => null);
        c.conflict = { base: c.docBase.md, other: fresh && "md" in fresh ? fresh.md : "", otherHash: fresh?.hash ?? c.docBase.hash };
        return "conflict";
      }
      c.error = e.code;
      return "error";
    }
  }

  /** 3-way 「あなたの版で上書き」. */
  overwriteDocEdit(c: ComposerSession): Promise<"saved" | "dropped" | "conflict" | "error"> {
    if (!c.conflict) return Promise.resolve("error");
    c.docBase = { md: c.conflict.other, hash: c.conflict.otherHash };
    c.conflict = null;
    return this.saveDocEdit(c);
  }

  /** The doc_edit draft's 2-way choice (Inbox `1` / `2`): 1 = make the code follow (job), 2 = fix the doc. */
  async chooseDocEdit(th: ThreadId, target: "code" | "doc", block: BlockId, md: string, baseHash: string): Promise<boolean> {
    const ws = this.ws;
    if (!ws) return false;
    try {
      const res = await this.s.api.call("POST /ws/:ws/doc/blocks/:block/edit", {
        params: { ws, block },
        body: { baseHash, md, mdForm: "file", apply: target },
      });
      if (res.block) this.s.doc.upsertBlock(res.block);
      if (res.thread) this.s.review.threads.set(res.thread.id, res.thread);
      if (target === "doc") await this.s.api.call("DELETE /ws/:ws/threads/:th", { params: { ws, th } }).catch(() => {});
      if (target === "code" && res.thread && res.estimate) {
        const job = await this.s.api.call("POST /ws/:ws/jobs", {
          params: { ws },
          body: {
            kind: "fix",
            threads: [res.thread.id],
            estimateId: res.estimate.estimate.id,
            ...(res.estimate.estimate.requiresConfirm ? { confirm: true } : {}),
          },
        });
        this.s.review.jobs.set(job.id, job);
      }
      return true;
    } catch (err) {
      this.s.bottom.toast({
        id: "loop.docEdit",
        kind: "error",
        key: "composer.toast.sendFailed",
        params: { error: errorText(MitoriError.from(err).toData()) },
      });
      return false;
    }
  }

  // =============================================================================== jobs
  async cancelJob(job: JobId): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const j = await this.s.api.call("POST /ws/:ws/jobs/:job/cancel", { params: { ws, job } });
      this.s.review.jobs.set(j.id, j);
    } catch (err) {
      this.#error(err);
    }
  }

  async retryJob(job: JobId, engine?: "claude-cli" | "anthropic-api"): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const j = await this.s.api.call("POST /ws/:ws/jobs/:job/retry", { params: { ws, job }, body: engine ? { engine } : {} });
      this.s.review.jobs.set(j.id, j);
    } catch (err) {
      this.#error(err);
    }
  }

  async runGates(job: JobId): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const j = await this.s.api.call("POST /ws/:ws/jobs/:job/gates/run", { params: { ws, job }, body: {} });
      this.s.review.jobs.set(j.id, j);
    } catch (err) {
      this.#error(err);
    }
  }

  async revise(job: JobId, message: string): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const j = await this.s.api.call("POST /ws/:ws/jobs/:job/revise", { params: { ws, job }, body: { message } });
      this.s.review.jobs.set(j.id, j);
    } catch (err) {
      this.#error(err);
    }
  }

  /** Accept (all / focus units). Applied ⇒ checkpoint undo toast + flash; remote-readonly ⇒ `.patch`. */
  async accept(job: JobId, req: AcceptReq): Promise<boolean> {
    const ws = this.ws;
    if (!ws) return false;
    this.accepting.set(job, true);
    try {
      const res = await this.s.api.call("POST /ws/:ws/jobs/:job/accept", { params: { ws, job }, body: req });
      this.s.review.jobs.set(res.job.id, res.job);
      if (res.kind === "applied") {
        this.checkpoints.set(res.checkpoint.id, res.checkpoint);
        const blocks = res.job.proposals.length;
        const level = this.s.doc.level;
        this.undo.accepted(job, res.checkpoint.id, level === "expert" ? "review.toast.acceptedExpert" : "review.toast.accepted", {
          n: res.files.length,
          m: req.proposals?.length ?? blocks,
          ref: res.checkpoint.ref,
        });
        this.s.ui.announce(t("review.a11y.accepted"));
        const touched = new Set<BlockId>();
        for (const id of res.job.threads) {
          const b = this.s.review.threads.get(id)?.anchor.doc?.block;
          if (b) touched.add(b);
        }
        this.flash([...touched]);
      } else {
        this.s.bottom.toast({
          id: "accept.patch",
          kind: "success",
          key: "review.toast.patch",
          params: { path: res.patchFile },
          action: { key: "review.action.copyPath", run: () => void copyText(res.patchFile, this.s, "copy.path") },
        });
      }
      return true;
    } catch (err) {
      const e = MitoriError.from(err);
      if (e.code === "E_GIT_MERGE_CONFLICT") {
        const files = (e.params?.files as string | undefined)?.split(",").filter(Boolean) ?? [];
        this.dialog = { kind: "conflict", job, files };
      } else this.#error(err);
      return false;
    } finally {
      this.accepting.delete(job);
    }
  }

  /** ⌘⌫ / 却下: deferred (no confirmation; undo toast). */
  reject(job: JobId): void {
    const j = this.s.review.jobs.get(job);
    const th = j?.threads[0] ? this.s.review.threads.get(j.threads[0]) : undefined;
    this.undo.rejectLater(job, { th: th?.title ?? job });
  }

  async commit(job: JobId): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const r = await this.s.api.call("POST /ws/:ws/jobs/:job/commit", { params: { ws, job }, body: {} });
      this.s.bottom.toast({ id: "loop.commit", kind: "success", key: "review.toast.committed", params: { commit: r.commit.slice(0, 7) } });
    } catch (err) {
      this.#error(err);
    }
  }

  /** 「差分をコピー」: unified diff text of the job. */
  async copyDiff(job: JobId): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const files = await this.s.api.call("GET /ws/:ws/jobs/:job/diff", { params: { ws, job } });
      const text = files
        .map((f) =>
          [
            `--- a/${f.oldPath ?? f.path}`,
            `+++ b/${f.path}`,
            ...f.hunks.flatMap((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines]),
          ].join("\n"),
        )
        .join("\n");
      await copyText(`${text}\n`, this.s, "copy.diff");
    } catch (err) {
      this.#error(err);
    }
  }

  /** Blocks touched by an accept: flash once (CSS `.blk.flash`), focus the first (UXP-38). */
  flash(blocks: readonly BlockId[]): void {
    this.flashed = blocks;
    requestAnimationFrame(() => {
      let first: HTMLElement | null = null;
      for (const b of blocks) {
        const el = document.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(b)}"]`);
        if (!el) continue;
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash", "changed");
        first ??= el;
      }
      first?.focus({ preventScroll: true });
    });
  }

  // =============================================================================== threads
  async transition(
    th: ThreadId,
    on: "resolve" | "reopen" | "reply" | "cancel",
    extra: { message?: string; resolution?: "answered" | "wontfix" | "applied" } = {},
  ): Promise<boolean> {
    const ws = this.ws;
    const cur = this.s.review.threads.get(th);
    if (!ws || !cur) return false;
    try {
      const d = await this.s.api.call("POST /ws/:ws/threads/:th/transition", { params: { ws, th }, body: { on, version: cur.version, ...extra } });
      this.s.review.threads.set(th, { ...cur, ...d, preview: extra.message?.slice(0, 120) ?? cur.preview, messages: d.messages.length });
      this.messages.set(th, d.messages);
      return true;
    } catch (err) {
      this.#error(err);
      return false;
    }
  }

  /** Events of a job that started before this tab was open (the SSE ring only has what arrived since). */
  async ensureEvents(job: JobId): Promise<void> {
    const ws = this.ws;
    if (!ws || job.startsWith("tmp_") || this.s.review.events(job).length > 0 || this.#eventsLoaded.has(job)) return;
    this.#eventsLoaded.add(job);
    try {
      const ev = await this.s.api.call("GET /ws/:ws/jobs/:job/events", { params: { ws, job } });
      if (this.s.review.events(job).length === 0) for (const e of ev) this.s.review.pushEvent(job, e);
    } catch {
      this.#eventsLoaded.delete(job);
    }
  }
  #eventsLoaded = new Set<JobId>();

  async reply(th: ThreadId, body: string): Promise<boolean> {
    const ws = this.ws;
    const cur = this.s.review.threads.get(th);
    if (!ws || !cur || !body.trim()) return false;
    try {
      const d = await this.s.api.call("POST /ws/:ws/threads/:th/messages", { params: { ws, th }, body: { body, version: cur.version } });
      this.s.review.threads.set(th, { ...cur, ...d, preview: body.slice(0, 120), messages: d.messages.length });
      this.messages.set(th, d.messages);
      return true;
    } catch (err) {
      this.#error(err);
      return false;
    }
  }

  async promote(th: ThreadId, to: "doc" | "decision"): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const r = await this.s.api.call("POST /ws/:ws/threads/:th/promote", { params: { ws, th }, body: { to } });
      if (r.proposal) this.s.doc.upsertProposal(r.proposal);
      this.s.bottom.toast({ id: "loop.promote", kind: "success", key: to === "doc" ? "threads.toast.promotedDoc" : "threads.toast.promotedDecision" });
    } catch (err) {
      this.#error(err);
    }
  }

  async setSendToAi(th: ThreadId, on: boolean): Promise<void> {
    const ws = this.ws;
    const cur = this.s.review.threads.get(th);
    if (!ws || !cur) return;
    try {
      const d = await this.s.api.call("PATCH /ws/:ws/threads/:th", { params: { ws, th }, body: { version: cur.version, sendToAi: on } });
      this.s.review.threads.set(th, { ...cur, ...d, preview: cur.preview, messages: cur.messages });
      void this.refreshReview();
    } catch (err) {
      this.#error(err);
    }
  }

  /** 「ここに付け直す」: the outdated thread moves to the selected range (`POST /threads/:th/reanchor`). */
  async reanchor(th: ThreadId, anchor: AnchorInput): Promise<boolean> {
    const ws = this.ws;
    const cur = this.s.review.threads.get(th);
    if (!ws || !cur) return false;
    try {
      const d = await this.s.api.call("POST /ws/:ws/threads/:th/reanchor", { params: { ws, th }, body: { anchor, version: cur.version } });
      this.s.review.threads.set(th, { ...cur, ...d, preview: cur.preview, messages: d.messages.length });
      this.reanchoring = null;
      this.s.bottom.toast({ id: "loop.reanchor", kind: "success", key: "threads.toast.reanchored" });
      return true;
    } catch (err) {
      this.#error(err);
      return false;
    }
  }

  /** `p` / ⧉: the prompt for my own agent (no engine needed). */
  async copyPrompt(anchor: Anchor, ask: string, intent: ThreadIntent): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    try {
      const r = await this.s.api.call("POST /ws/:ws/prompt", { params: { ws }, body: { anchor, ask, intent, target: "claude-code" } });
      await copyText(r.text, this.s, "copy.prompt", { k: Math.round(r.tokens / 100) / 10 });
    } catch (err) {
      this.#error(err);
    }
  }

  // =============================================================================== Finish / trust
  async finish(mode: "push" | "pull", opts: { threads?: ThreadId[]; estimateId?: string; confirm?: boolean } = {}): Promise<boolean> {
    const ws = this.ws;
    if (!ws) return false;
    try {
      const r = await this.s.api.call("POST /ws/:ws/review/finish", {
        params: { ws },
        body: {
          mode,
          ...(opts.threads ? { threads: opts.threads } : {}),
          ...(opts.estimateId ? { estimateId: opts.estimateId as `es_${string}` } : {}),
          ...(opts.confirm ? { confirm: true } : {}),
        },
      });
      for (const j of r.jobs) this.s.review.jobs.set(j.id, j);
      this.s.review.round = this.s.review.round ? { ...this.s.review.round, round: r.round, pending: [] } : null;
      void this.refreshReview();
      return true;
    } catch (err) {
      this.#error(err);
      return false;
    }
  }

  async decideTrust(id: TrustItemId, decision: "trusted" | "denied"): Promise<boolean> {
    const ws = this.ws;
    if (!ws) return false;
    try {
      await this.s.api.call("POST /ws/:ws/trust/:tr", { params: { ws, tr: id }, body: { decision } });
      const cur = this.trust.get(id);
      if (cur) this.#onTrust({ ...cur, status: decision });
      this.s.bottom.dismiss("trust.pending");
      // The server does not re-run gates on a trust decision (loop-wiring request 5: that would run repo code without a
      // click). Approving from the Review panel IS the click — the diff and the command are on screen — so run the
      // job's `untrusted` gates now; otherwise the panel keeps saying 「検査なし」 after the approval (live finding).
      const route = this.s.router.route;
      if (decision === "trusted" && route.name === "review") {
        const j = this.s.review.jobs.get(route.job);
        if (j?.gates.some((g) => g.status === "untrusted")) void this.runGates(route.job);
      }
      return true;
    } catch (err) {
      this.#error(err);
      return false;
    }
  }

  #error(err: unknown): void {
    this.s.bottom.toast({ id: "loop.error", kind: "error", key: "review.toast.failed", params: { error: errorText(MitoriError.from(err).toData()) } });
  }
}
