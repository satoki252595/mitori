/** Worker and index I/O enter on the first palette request. Open/query state stays synchronous. */
import type { ApiClient } from "@mitori/client";
import type { PaletteIndex, WorkspaceKey } from "@mitori/core";
import type { PaletteActionItem, PaletteGroupResult, PaletteWorkerMsg, PaletteWorkerReply } from "../contract.ts";
import { markAfterPaint } from "../shell/perf.ts";
import type { PaletteState, PaletteTop } from "../stores/palette.svelte.ts";

export class PaletteController {
  #worker: Worker | null = null;
  #workerFor: WorkspaceKey | null | undefined;
  #qid = 0;
  #items: PaletteIndex["items"] = [];
  #loadedFor: WorkspaceKey | null | undefined;
  #epoch = 0;

  constructor(
    private readonly state: PaletteState,
    private readonly api: ApiClient,
    private readonly ws: () => WorkspaceKey | null,
    private readonly makeWorker: () => Worker,
    private readonly actions: () => PaletteActionItem[],
    private readonly keyAt: () => number,
  ) {}

  setActions(actions: PaletteActionItem[]): void {
    if (this.#worker && this.#loadedFor === this.ws())
      this.#worker.postMessage({ t: "load", rev: this.state.rev, items: this.#items, actions } satisfies PaletteWorkerMsg);
  }

  #ensureWorker(): Worker {
    const ws = this.ws();
    if (this.#worker && this.#workerFor === ws) return this.#worker;
    this.#worker?.terminate();
    this.#workerFor = ws;
    this.#loadedFor = undefined;
    this.#items = [];
    this.#epoch++;
    const worker = this.makeWorker();
    this.#worker = worker;
    worker.onmessage = (ev: MessageEvent<PaletteWorkerReply & { counts?: Partial<Record<PaletteGroupResult["group"], number>>; top?: PaletteTop | null }>) => {
      if (this.#worker !== worker || this.ws() !== ws) return;
      const reply = ev.data;
      if (reply.t === "loaded") {
        this.state.rev = reply.rev;
        this.state.status = "ready";
        if (this.state.query) this.send();
        return;
      }
      if (reply.id !== this.#qid) return;
      this.state.answered = this.state.query;
      this.state.results = reply.groups;
      this.state.total = reply.total;
      this.state.ms = reply.ms;
      this.state.counts = reply.counts ?? {};
      this.state.top = reply.top ?? null;
      markAfterPaint("mitori:palette:results", { trigger: this.keyAt() });
    };
    return worker;
  }

  async loadIndex(force = false): Promise<void> {
    const ws = this.ws();
    const worker = this.#ensureWorker();
    if (!force && this.#loadedFor === ws) return;
    this.#loadedFor = ws;
    if (!ws) {
      worker.postMessage({ t: "load", rev: 0, items: [], actions: this.actions() } satisfies PaletteWorkerMsg);
      return;
    }
    const epoch = ++this.#epoch;
    this.state.status = "loading";
    const current = () => this.ws() === ws && this.#worker === worker && this.#epoch === epoch;
    try {
      const index = await this.api.call("GET /ws/:ws/search/palette", { params: { ws } });
      if (!current()) return;
      this.#items = index.items;
      worker.postMessage({ t: "load", rev: index.rev, items: index.items, actions: this.actions() } satisfies PaletteWorkerMsg);
    } catch {
      if (!current()) return;
      this.state.status = "error";
      this.#items = [];
      worker.postMessage({ t: "load", rev: 0, items: [], actions: this.actions() } satisfies PaletteWorkerMsg);
    }
  }

  send(): void {
    const worker = this.#ensureWorker();
    const id = ++this.#qid;
    if (!this.state.query.trim()) {
      this.state.results = [];
      this.state.total = 0;
      this.state.top = null;
      return;
    }
    worker.postMessage({ t: "query", id, q: this.state.query, scope: this.state.scope, groupMax: 3 } satisfies PaletteWorkerMsg);
  }

  invalidate(): void {
    this.#loadedFor = undefined;
    if (this.#worker) void this.loadIndex(true);
  }
}
