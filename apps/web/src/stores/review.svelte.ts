/**
 * Threads + jobs (contract `ReviewStore`). WP-10a keeps the data that the shell needs — header job chip,
 * status bar, Inbox / review tab badges, map pins, `r` availability — fed by SSE; the review loop UI that edits
 * them (Composer, cards, Review panel, decisions) is WP-10b's and builds on this store.
 */
import type { ApiClient } from "@mitori/client";
import type { BlockId, JobDetail, JobEvent, JobId, ReviewStatus, ThreadDetail, ThreadId, ThreadSummary, WorkspaceKey } from "@mitori/core";
import { SvelteMap } from "svelte/reactivity";
import { type ReviewDecisions, type ReviewStore, UI_THRESHOLDS } from "../contract.ts";

const RUNNING = new Set(["preparing", "running", "gating", "repairing", "accepting"]);

export class ReviewState implements ReviewStore {
  threads = new SvelteMap<string, ThreadSummary>();
  jobs = new SvelteMap<JobId, import("@mitori/core").JobSummary>();
  round = $state.raw<ReviewStatus | null>(null);
  pendingRejects = new SvelteMap<JobId, number>();
  #events = new SvelteMap<JobId, readonly JobEvent[]>();
  #decisions = new Map<JobId, ReviewDecisions>();
  private readonly api: ApiClient;
  private readonly ws: () => WorkspaceKey | null;

  constructor(api: ApiClient, ws: () => WorkspaceKey | null) {
    this.api = api;
    this.ws = ws;
  }

  reset(): void {
    this.threads.clear();
    this.jobs.clear();
    this.#events.clear();
    this.round = null;
  }

  #loading: Promise<void> | null = null;

  /** The current threads / jobs load (a redirect that depends on them waits for it). */
  whenLoaded(): Promise<void> {
    return this.#loading ?? Promise.resolve();
  }

  load(): Promise<void> {
    const p = this.#load();
    this.#loading = p;
    return p;
  }

  async #load(): Promise<void> {
    const ws = this.ws();
    if (!ws) return;
    const [th, jb] = await Promise.allSettled([
      this.api.call("GET /ws/:ws/threads", { params: { ws }, query: { limit: 200 } }),
      this.api.call("GET /ws/:ws/jobs", { params: { ws }, query: { limit: 200 } }),
    ]);
    if (this.ws() !== ws) return;
    if (th.status === "fulfilled") for (const t of th.value.items) this.threads.set(t.id, t);
    if (jb.status === "fulfilled") for (const j of jb.value.items) this.jobs.set(j.id, j);
  }

  events(job: JobId): readonly JobEvent[] {
    return this.#events.get(job) ?? [];
  }

  pushEvent(job: JobId, e: JobEvent): void {
    const cur = this.#events.get(job) ?? [];
    const next = cur.length >= UI_THRESHOLDS.jobEventRing ? [...cur.slice(1), e] : [...cur, e];
    this.#events.set(job, next);
  }

  forBlock(block: BlockId): readonly ThreadSummary[] {
    const out: ThreadSummary[] = [];
    for (const t of this.threads.values()) if (t.anchor.doc?.block === block) out.push(t);
    return out;
  }

  detail(th: ThreadId): Promise<ThreadDetail> {
    const ws = this.ws();
    if (!ws) return Promise.reject(new Error("no workspace"));
    return this.api.call("GET /ws/:ws/threads/:th", { params: { ws, th } });
  }

  jobDetail(job: JobId): Promise<JobDetail> {
    const ws = this.ws();
    if (!ws) return Promise.reject(new Error("no workspace"));
    return this.api.call("GET /ws/:ws/jobs/:job", { params: { ws, job } });
  }

  decisions(job: JobId): ReviewDecisions {
    let d = this.#decisions.get(job);
    if (!d) {
      d = { job, hunks: new Map(), proposals: new Map(), focus: { kind: "all" } };
      this.#decisions.set(job, d);
    }
    return d;
  }

  /** Header job chip counts (ux.md §3.3-8). */
  get chip(): { running: number; locked: number; ready: number } {
    let running = 0;
    let locked = 0;
    let ready = 0;
    for (const j of this.jobs.values()) {
      if (RUNNING.has(j.state)) running++;
      else if (j.state === "waiting_lock") locked++;
      else if (j.state === "ready" && !this.pendingRejects.has(j.id)) ready++;
    }
    return { running, locked, ready };
  }

  get queued(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.state === "queued") n++;
    return n;
  }

  /** Oldest ready job (the `r` key / `/review` redirect). */
  oldestReady(): JobId | null {
    let best: { id: JobId; at: string } | null = null;
    for (const j of this.jobs.values()) {
      if (j.state !== "ready" || this.pendingRejects.has(j.id)) continue;
      const at = j.finishedAt ?? j.createdAt;
      if (!best || at < best.at) best = { id: j.id, at };
    }
    return best?.id ?? null;
  }

  /** Open thread counts per diagram node (map pins). */
  /** Unresolved threads per section of their anchor block (TOC badges, ux.md §4.3.2-3). */
  threadsBySection(blockSection: ReadonlyMap<BlockId, string>): Map<string, number> {
    const out = new Map<string, number>();
    for (const t of this.threads.values()) {
      const b = t.anchor.doc?.block;
      const sec = b ? blockSection.get(b) : undefined;
      if (!sec || t.state === "resolved" || t.state === "draft") continue;
      out.set(sec, (out.get(sec) ?? 0) + 1);
    }
    return out;
  }

  pinsByNode(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of this.threads.values()) {
      const node = t.anchor.diagram?.node;
      if (!node || t.state === "resolved" || t.state === "draft") continue;
      out[node] = (out[node] ?? 0) + 1;
    }
    return out;
  }
}
