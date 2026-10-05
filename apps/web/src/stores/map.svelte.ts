/**
 * S1 map store (contract `MapStore`). The camera is plain data: FloorPlan writes it straight to the DOM (no
 * reactive re-render per frame); only the derived zoom stage is reactive.
 */
import type { ApiClient } from "@mitori/client";
import { type MapView, MitoriError, type MitoriErrorData, type SectionId, type UiLang, type WorkspaceKey } from "@mitori/core";
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
  private readonly lang: () => UiLang;
  #loadedLang: UiLang | null = null;
  #loadedFor: WorkspaceKey | null = null;
  #epoch = 0;
  #throttle: ReturnType<typeof setTimeout> | null = null;

  constructor(api: ApiClient, ws: () => WorkspaceKey | null, lang: () => UiLang = () => "ja") {
    this.api = api;
    this.ws = ws;
    this.lang = lang;
  }

  /**
   * The floor plan was attempted and failed its quality gate (CR m1-103): only then is the container map a
   * fallback worth a note. The MVP container map (floor plan flag off ⇒ no `quality`) is the intended view.
   */
  get fallback(): boolean {
    return this.view?.fallback === "container" && this.view.quality !== undefined;
  }

  async load(force = false): Promise<void> {
    const ws = this.ws();
    const lang = this.lang();
    if (!ws || (!force && this.#loadedFor === ws && this.#loadedLang === lang && this.view)) return;
    const epoch = ++this.#epoch;
    this.#loadedFor = ws;
    this.#loadedLang = lang;
    try {
      const v = await this.api.call("GET /ws/:ws/map", { params: { ws }, query: { svg: true, lang } });
      if (!v.plan || v.svg === undefined) {
        const { legacyPresentation } = await import("../map/legacy.ts");
        Object.assign(v, legacyPresentation(v, ws, lang));
      }
      if (epoch === this.#epoch && this.ws() === ws && this.lang() === lang) {
        this.view = v;
        this.error = null;
      }
    } catch (err) {
      if (epoch === this.#epoch && this.ws() === ws && this.lang() === lang) this.error = MitoriError.from(err).toData();
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
    this.#epoch++;
    this.view = null;
    this.selected = null;
    this.flow = null;
    this.#loadedFor = null;
    this.#loadedLang = null;
  }
}
