/**
 * Current workspace (contract `WorkspaceStore`): `GET /ws/:ws`, scan progress from SSE, and the error state.
 */
import type { ApiClient } from "@mitori/client";
import { MitoriError, type MitoriErrorData, type ScanStage, type WorkspaceKey, type WorkspaceStatus, type WorkspaceSummary } from "@mitori/core";
import type { WorkspaceStore } from "../contract.ts";

export class WorkspaceState implements WorkspaceStore {
  key = $state<WorkspaceKey | null>(null);
  status = $state.raw<WorkspaceStatus | null>(null);
  scan = $state.raw<{ stage: ScanStage; done: number; total: number } | null>(null);
  error = $state.raw<MitoriErrorData | null>(null);
  loading = $state(false);
  private readonly api: ApiClient;
  #inflight: Promise<void> | null = null;

  constructor(api: ApiClient) {
    this.api = api;
  }

  open(ws: WorkspaceKey): Promise<void> {
    if (this.key === ws && (this.status || this.#inflight)) return this.#inflight ?? Promise.resolve();
    this.key = ws;
    this.status = null;
    this.scan = null;
    this.error = null;
    return this.refresh();
  }

  refresh(): Promise<void> {
    const ws = this.key;
    if (!ws) return Promise.resolve();
    this.loading = true;
    const p = this.api
      .call("GET /ws/:ws", { params: { ws } })
      .then((s) => {
        if (this.key !== ws) return;
        this.status = s;
        this.error = s.state === "error" ? (s.lastError ?? null) : null;
      })
      .catch((err: unknown) => {
        if (this.key === ws) this.error = MitoriError.from(err).toData();
      })
      .finally(() => {
        if (this.#inflight === p) this.#inflight = null;
        this.loading = false;
      });
    this.#inflight = p;
    return p;
  }

  async rescan(): Promise<void> {
    const ws = this.key;
    if (!ws) return;
    this.error = null;
    try {
      await this.api.call("POST /ws/:ws/scan", { params: { ws }, body: { force: true } });
    } catch (err) {
      this.error = MitoriError.from(err).toData();
    }
  }

  applySummary(s: WorkspaceSummary): void {
    if (this.status && s.info.key === this.status.info.key) this.status = { ...this.status, ...s };
  }

  get name(): string {
    return this.status?.info.name ?? "";
  }

  get head7(): string {
    return this.status?.snapshot?.commit?.slice(0, 7) ?? "";
  }
}
