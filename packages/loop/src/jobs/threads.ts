// What a job does to its threads (loop spec §2.3): every state change goes through the review engine's
// `transition` (core THREAD_TRANSITIONS is the only judge); agent messages — answers, proposals, outcomes — are
// stored with the job id and published as `thread.message`. All methods are synchronous and run inside the
// caller's workspace write slot.
import {
  type Clock,
  canTransition,
  type EventSink,
  type JobId,
  type Message,
  type MessageAuthor,
  newId,
  type Random,
  type Resolution,
  type SqlDb,
  type SseEventPayload,
  type ThreadId,
  type ThreadTrigger,
  type TransitionActor,
} from "@mitori/core";
import type { ReviewEngine } from "../contract.ts";
import { ReviewStore } from "../review/store.ts";

/** Ports. */
export interface ThreadPortDeps {
  review: ReviewEngine;
  db: SqlDb;
  random: Random;
  clock: Clock;
  events: EventSink<SseEventPayload>;
  renderMessage: (md: string) => string;
}

/** Thread effects of jobs. */
export class JobThreads {
  private readonly store: ReviewStore;

  constructor(private readonly deps: ThreadPortDeps) {
    this.store = new ReviewStore(deps.db);
  }

  /** Current state (null when the thread is gone). */
  state(id: ThreadId): string | null {
    return this.store.thread(id)?.thread.state ?? null;
  }

  /** Fire `on` when the table allows it from the current state; returns whether it fired. */
  fire(id: ThreadId, on: ThreadTrigger, by: TransitionActor, opts: { resolution?: Resolution; message?: string } = {}): boolean {
    const t = this.store.thread(id)?.thread;
    if (!t || !canTransition({ machine: "thread", from: t.state, on, by })) return false;
    const req: Parameters<ReviewEngine["transition"]>[1] = { on, version: t.version };
    if (opts.resolution !== undefined) req.resolution = opts.resolution;
    if (opts.message !== undefined) req.message = opts.message;
    this.deps.review.transition(id, req, by);
    return true;
  }

  /** The doc_edit target text of a thread (spec §2.6.3), or null. */
  targetDocMd(id: ThreadId): string | null {
    return this.store.thread(id)?.targetDocMd ?? null;
  }

  /** Append an agent / system message produced by `job`. */
  say(id: ThreadId, job: JobId, by: MessageAuthor, kind: Message["kind"], body: string, cites?: Message["cites"]): void {
    const t = this.store.thread(id)?.thread;
    if (!t) return;
    const m: Message = {
      id: newId("message", this.deps.random),
      thread: id,
      by,
      kind,
      body: body.replace(/\r\n?/g, "\n"),
      round: t.round,
      job,
      createdAt: this.deps.clock.iso(),
    };
    if (cites && cites.length > 0) m.cites = cites;
    this.store.insertMessage(m);
    this.deps.events.emit({ type: "thread.message", message: { ...m, html: this.deps.renderMessage(m.body) } });
    const summary = this.deps.review.summary(id);
    if (summary) this.deps.events.emit({ type: "thread.upsert", thread: summary });
  }

  /** Publish the summary of every thread of a job (its `jobState` changed). */
  touch(ids: readonly ThreadId[]): void {
    for (const id of ids) {
      const s = this.deps.review.summary(id);
      if (s) this.deps.events.emit({ type: "thread.upsert", thread: s });
    }
  }
}
