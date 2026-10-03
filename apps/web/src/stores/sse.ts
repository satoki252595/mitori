/**
 * SSE type → store table (ux.md §12.3). Workspace entities are de-duplicated by envelope `rev` against
 * `x-mitori-rev` of our own mutations (`SseClient.isStale` / `noteRev`); unknown types are ignored.
 */
import type { EntityKey, SseClient } from "@mitori/client";
import type { SseEvent } from "@mitori/core";
import { applySettings, type Stores } from "./app.svelte.ts";

type Of<T extends SseEvent["type"]> = Extract<SseEvent, { type: T }>;

export interface SseHooks {
  /** Refetch everything mounted (resync / fresh hello after a gap). */
  resync(): void;
  notice(e: Of<"notice">): void;
  firstBlock(e: Of<"doc.block.upsert">): void;
  genDone(e: Of<"gen.run">): void;
}

/**
 * WEB-U-026: an upsert is applied only when its envelope `rev` is newer than the one that produced the current
 * value (`rev ≤ entityRev[key]` ⇒ dropped); an applied upsert records its `rev`, so an older replay (resume
 * after a reconnect, out-of-order delivery) can never overwrite a newer value. Events without `rev` pass.
 */
export function acceptUpsert(sse: Pick<SseClient, "isStale" | "noteRev">, key: EntityKey, e: Pick<SseEvent, "rev">): boolean {
  if (e.rev === null) return true;
  if (sse.isStale(key, e.rev)) return false;
  sse.noteRev(key, e.rev);
  return true;
}

/**
 * Progress entities (a generation run and its tasks) change many times within ONE workspace `rev` (pending →
 * running → done): only an event of an OLDER rev is a replay; the same rev is a newer state of the same stream.
 */
export function acceptProgress(sse: Pick<SseClient, "isStale" | "noteRev">, key: EntityKey, e: Pick<SseEvent, "rev">): boolean {
  if (e.rev === null) return true;
  if (sse.isStale(key, e.rev + 1)) return false;
  sse.noteRev(key, e.rev);
  return true;
}

export function wireSse(s: Stores, hooks: SseHooks): () => void {
  const sse = s.sse;
  const stale = (key: EntityKey, e: SseEvent) => !acceptUpsert(sse, key, e);
  const replayed = (key: EntityKey, e: SseEvent) => !acceptProgress(sse, key, e);
  const offs = [
    sse.on("resync", () => hooks.resync()),
    sse.on("server.shutdown", () => {}),
    sse.on("notice", (e) => hooks.notice(e)),
    sse.on("engines.updated", (e) => {
      s.session.engines = e.engines;
    }),
    sse.on("scheduler.updated", (e) => {
      s.session.scheduler = e.scheduler;
    }),
    sse.on("usage.updated", (e) => {
      s.session.today = e.today;
      if (e.window) s.session.window = e.window;
    }),
    sse.on("workspace.updated", (e) => {
      s.session.upsertWorkspace(e.summary);
      s.workspace.applySummary(e.summary);
    }),
    sse.on("settings.updated", () => {
      void s.session.loadSettings().then((v) => applySettings(s, v));
    }),
    sse.on("scan.progress", (e) => {
      s.workspace.scan = { stage: e.stage, done: e.done, total: e.total };
    }),
    sse.on("scan.done", () => {
      s.workspace.scan = null;
      void s.workspace.refresh();
      s.map.invalidate();
    }),
    sse.on("scan.failed", (e) => {
      s.workspace.scan = null;
      s.workspace.error = e.error;
    }),
    sse.on("index.changed", (e) => {
      s.workspace.changed = { paths: e.paths, seq: e.seq };
    }),
    sse.on("map.updated", () => s.map.invalidate()),
    sse.on("doc.outline", (e) => {
      if (!s.doc.outline || e.outlineRev > s.doc.outline.outlineRev) void s.doc.loadOutline();
    }),
    sse.on("doc.block.upsert", (e) => {
      if (stale(`block:${e.block.id}`, e)) return;
      hooks.firstBlock(e);
      s.doc.upsertBlock(e.block);
    }),
    sse.on("doc.block.partial", (e) => s.doc.partial(e.section, e.text)),
    sse.on("doc.block.removed", (e) => s.doc.removeBlock(e.block, e.section)),
    sse.on("doc.freshness", (e) => s.doc.applyFreshness(e.blocks, e.freshness)),
    sse.on("doc.claims", (e) => s.doc.applyClaims(e.claims)),
    sse.on("doc.proposal.upsert", (e) => {
      if (stale(`proposal:${e.proposal.id}`, e)) return;
      s.doc.upsertProposal(e.proposal);
    }),
    sse.on("doc.proposal.removed", (e) => s.doc.removeProposal(e.id)),
    sse.on("gen.run", (e) => {
      if (replayed(`run:${e.run.id}`, e)) return;
      const wasActive = s.gen.run?.state === "running";
      s.gen.applyRun(e.run);
      if (wasActive && e.run.state === "done") hooks.genDone(e);
    }),
    sse.on("gen.task", (e) => {
      if (replayed(`task:${e.task.id}`, e)) return;
      s.gen.applyTask(e.task);
    }),
    sse.on("palette.changed", () => s.palette.invalidate()),
    sse.on("thread.upsert", (e) => {
      if (stale(`thread:${e.thread.id}`, e)) return;
      s.review.threads.set(e.thread.id, e.thread);
    }),
    sse.on("thread.removed", (e) => {
      s.review.threads.delete(e.id);
    }),
    sse.on("job.upsert", (e) => {
      if (stale(`job:${e.job.id}`, e)) return;
      s.review.jobs.set(e.job.id, e.job);
    }),
    sse.on("job.event", (e) => s.review.pushEvent(e.job, e.event)),
    sse.on("review.round", () => {}),
  ];
  return () => {
    for (const off of offs) off();
  };
}
