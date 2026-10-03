/**
 * ⌘K state (contract `PaletteStore`, ux.md §4.10). The index (`GET /search/palette`, ≤ 50k items) lives in the
 * palette worker; this store only sends `load` / `query` and keeps the reply of the LATEST query id.
 */
import type { ApiClient } from "@mitori/client";
import type { PaletteIndex, WorkspaceKey } from "@mitori/core";
import type { PaletteActionItem, PaletteGroupResult, PaletteStore, PaletteWorkerMsg, PaletteWorkerReply } from "../contract.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { getJson, STORAGE_KEYS, setJson } from "../shell/storage.ts";

/** Top-hit row chosen by the worker (score ≥ 120, a via-symbol yields to its term). */
export interface PaletteTop {
  group: PaletteGroupResult["group"];
  id: string;
}

export interface RecentEntry {
  id: string;
  label: string;
  href: string;
  group: PaletteGroupResult["group"];
}

export class PaletteState implements PaletteStore {
  open = $state(false);
  query = $state("");
  results = $state.raw<readonly PaletteGroupResult[]>([]);
  counts = $state.raw<Partial<Record<PaletteGroupResult["group"], number>>>({});
  top = $state.raw<PaletteTop | null>(null);
  crumbs = $state.raw<readonly string[]>([]);
  rev = $state(0);
  total = $state(0);
  ms = $state(0);
  status = $state<"idle" | "loading" | "ready" | "error">("idle");
  scope = $state<"all" | "doc" | "actions">("all");
  #worker: Worker | null = null;
  #qid = 0;
  #actions: PaletteActionItem[] = [];
  #actionsSig = "";
  #items: PaletteIndex["items"] = [];
  #loadedFor: WorkspaceKey | null = null;
  #keyAt = 0;
  private readonly api: ApiClient;
  private readonly ws: () => WorkspaceKey | null;
  private readonly makeWorker: () => Worker;

  constructor(api: ApiClient, ws: () => WorkspaceKey | null, makeWorker: () => Worker) {
    this.api = api;
    this.ws = ws;
    this.makeWorker = makeWorker;
  }

  /**
   * Client action items (labels follow the UI language). When they change after the index reached the worker —
   * the palette chunk mounted after the idle load, or the UI language switched — the worker gets them again.
   */
  setActions(a: PaletteActionItem[]): void {
    const sig = a.map((x) => `${x.i}\u0000${x.l}`).join("\u0001");
    if (sig === this.#actionsSig) return;
    this.#actionsSig = sig;
    this.#actions = a;
    if (this.#worker && this.#loadedFor !== null) {
      this.#worker.postMessage({ t: "load", rev: this.rev, items: this.#items, actions: a } satisfies PaletteWorkerMsg);
    }
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const w = this.makeWorker();
    w.onmessage = (ev: MessageEvent<PaletteWorkerReply & { counts?: Partial<Record<PaletteGroupResult["group"], number>>; top?: PaletteTop | null }>) => {
      const r = ev.data;
      if (r.t === "loaded") {
        this.rev = r.rev;
        this.status = "ready";
        if (this.query) this.#send();
        return;
      }
      if (r.id !== this.#qid) return; // stale reply (AC-U70)
      this.results = r.groups;
      this.total = r.total;
      this.ms = r.ms;
      this.counts = r.counts ?? {};
      this.top = r.top ?? null;
      markAfterPaint("mitori:palette:results", { trigger: this.#keyAt });
    };
    this.#worker = w;
    return w;
  }

  /** Fetch the index (idle or first ⌘K) and hand it to the worker. */
  async loadIndex(force = false): Promise<void> {
    const ws = this.ws();
    const w = this.#ensureWorker();
    if (!ws) {
      w.postMessage({ t: "load", rev: 0, items: [], actions: this.#actions } satisfies PaletteWorkerMsg);
      return;
    }
    if (!force && this.#loadedFor === ws) return;
    this.#loadedFor = ws;
    this.status = "loading";
    try {
      const ix: PaletteIndex = await this.api.call("GET /ws/:ws/search/palette", { params: { ws } });
      this.#items = ix.items;
      w.postMessage({ t: "load", rev: ix.rev, items: ix.items, actions: this.#actions } satisfies PaletteWorkerMsg);
    } catch {
      this.status = "error";
      this.#items = [];
      w.postMessage({ t: "load", rev: 0, items: [], actions: this.#actions } satisfies PaletteWorkerMsg);
    }
  }

  show(initial = "", scope: "all" | "doc" | "actions" = "all"): void {
    this.scope = scope;
    this.crumbs = scope === "doc" ? ["doc"] : scope === "actions" ? ["actions"] : [];
    this.open = true;
    this.setQuery(initial);
    void this.loadIndex();
  }

  hide(): void {
    this.open = false;
  }

  setQuery(q: string, keyAt = performance.now()): void {
    this.query = q;
    this.#keyAt = keyAt;
    this.#send();
  }

  #send(): void {
    const w = this.#ensureWorker();
    const id = ++this.#qid;
    if (!this.query.trim()) {
      this.results = [];
      this.total = 0;
      this.top = null;
      return;
    }
    w.postMessage({ t: "query", id, q: this.query, scope: this.scope, groupMax: 3 } satisfies PaletteWorkerMsg);
  }

  recents(): RecentEntry[] {
    const ws = this.ws();
    return ws ? (getJson<RecentEntry[]>("local", STORAGE_KEYS.recent(ws)) ?? []).slice(0, 5) : [];
  }

  remember(e: RecentEntry): void {
    const ws = this.ws();
    if (!ws) return;
    const list = (getJson<RecentEntry[]>("local", STORAGE_KEYS.recent(ws)) ?? []).filter((x) => x.id !== e.id);
    setJson("local", STORAGE_KEYS.recent(ws), [e, ...list].slice(0, 20));
  }

  invalidate(): void {
    this.#loadedFor = null;
    if (this.#worker) void this.loadIndex(true);
  }
}
