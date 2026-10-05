/**
 * ⌘K state (contract `PaletteStore`, ux.md §4.10). The index (`GET /search/palette`, ≤ 50k items) lives in the
 * palette worker; this store only sends `load` / `query` and keeps the reply of the LATEST query id.
 */
import type { ApiClient } from "@mitori/client";
import type { WorkspaceKey } from "@mitori/core";
import type { PaletteActionItem, PaletteGroupResult, PaletteStore } from "../contract.ts";
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

import type { PaletteController } from "../palette/controller.ts";

const loadController = () => import("../palette/controller.ts");

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
  /** The query the worker's latest reply answers (rows that depend on 「nothing matched」 wait for it). */
  answered = $state<string | null>(null);
  #controller: PaletteController | null = null;
  #loading: Promise<PaletteController> | null = null;
  #actions: PaletteActionItem[] = [];
  #actionsSig = "";
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
    this.#controller?.setActions(a);
  }

  #ensureController(): Promise<PaletteController> {
    if (this.#loading) return this.#loading;
    this.#loading = loadController()
      .then(({ PaletteController }) => {
        this.#controller = new PaletteController(
          this,
          this.api,
          this.ws,
          this.makeWorker,
          () => this.#actions,
          () => this.#keyAt,
        );
        return this.#controller;
      })
      .catch((error) => {
        this.#loading = null;
        this.status = "error";
        throw error;
      });
    return this.#loading;
  }

  /** Fetch the index (idle or first ⌘K) and hand it to the worker. */
  async loadIndex(force = false): Promise<void> {
    try {
      await (await this.#ensureController()).loadIndex(force);
    } catch {
      this.status = "error";
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
    if (this.#controller) this.#controller.send();
    else
      void this.#ensureController()
        .then((controller) => controller.send())
        .catch(() => {});
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
    this.#controller?.invalidate();
  }
}
