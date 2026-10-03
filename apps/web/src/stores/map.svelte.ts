/**
 * S1 map store (contract `MapStore`). The camera is plain data: FloorPlan writes it straight to the DOM (no
 * reactive re-render per frame); only the derived zoom stage is reactive.
 */
import type { ApiClient } from "@mitori/client";
import { type MapView, MitoriError, type MitoriErrorData, type SectionId, type WorkspaceKey } from "@mitori/core";
import type { MapCamera, MapStore, ZoomStage } from "../contract.ts";

export class MapState implements MapStore {
  view = $state.raw<MapView | null>(null);
  camera: MapCamera = { x: 0, y: 0, s: 1 };
  stage = $state<ZoomStage>("Z2");
  selected = $state<string | null>(null);
  flow = $state<SectionId | null>(null);
  overlays = $state({ comments: true, working: true, churn: false, freshness: false, allDeps: false, legend: false });
  error = $state.raw<MitoriErrorData | null>(null);
  private readonly api: ApiClient;
  private readonly ws: () => WorkspaceKey | null;
  #loadedFor: WorkspaceKey | null = null;
  #throttle: ReturnType<typeof setTimeout> | null = null;

  constructor(api: ApiClient, ws: () => WorkspaceKey | null) {
    this.api = api;
    this.ws = ws;
  }

  get fallback(): boolean {
    return this.view !== null && (this.view.fallback === "container" || this.view.diagram.kind !== "floorplan");
  }

  async load(force = false): Promise<void> {
    const ws = this.ws();
    if (!ws || (!force && this.#loadedFor === ws && this.view)) return;
    this.#loadedFor = ws;
    try {
      const v = await this.api.call("GET /ws/:ws/map", { params: { ws } });
      if (this.ws() === ws) {
        this.view = v;
        this.error = null;
      }
    } catch (err) {
      if (this.ws() === ws) this.error = MitoriError.from(err).toData();
    }
  }

  /** `map.updated` ⇒ refetch at most every 250 ms. */
  invalidate(): void {
    if (this.#throttle) return;
    this.#throttle = setTimeout(() => {
      this.#throttle = null;
      void this.load(true);
    }, 250);
  }

  reset(): void {
    this.view = null;
    this.selected = null;
    this.flow = null;
    this.#loadedFor = null;
  }
}
