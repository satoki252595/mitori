/**
 * Generation store (contract `GenStore`, ux.md §4.2.4–4.2.5): the three effort estimates fetched in parallel after
 * `mitori:map:painted`, the active run + its tasks (SSE `gen.run` / `gen.task`), start / control / prioritize.
 */
import type { ApiClient } from "@mitori/client";
import {
  type Effort,
  type EngineId,
  type GenEstimate,
  type GenRun,
  type GenTaskView,
  MitoriError,
  type MitoriErrorData,
  type SectionId,
  type WorkspaceKey,
} from "@mitori/core";
import { SvelteMap } from "svelte/reactivity";
import type { GenStore } from "../contract.ts";
import { EFFORTS } from "../gen/estimate.ts";

export class GenState implements GenStore {
  effort = $state<Effort>("standard");
  /** True once the user picked an effort (the default no longer follows the estimates). */
  effortChosen = $state(false);
  engine = $state<EngineId>("claude-cli");
  estimates = new SvelteMap<string, GenEstimate>();
  run = $state.raw<GenRun | null>(null);
  #tasks = new SvelteMap<string, GenTaskView>();
  error = $state.raw<MitoriErrorData | null>(null);
  starting = $state(false);
  /** Section estimates of placeholders (first click fetches, second click runs, ux.md §4.3.10). */
  sectionEstimates = new SvelteMap<SectionId, GenEstimate>();
  private readonly api: ApiClient;
  private readonly ws: () => WorkspaceKey | null;

  constructor(api: ApiClient, ws: () => WorkspaceKey | null) {
    this.api = api;
    this.ws = ws;
  }

  get tasks(): readonly GenTaskView[] {
    return [...this.#tasks.values()];
  }

  key(effort: Effort, engine: EngineId = this.engine): string {
    return `${effort}|${engine}`;
  }

  current(): GenEstimate | undefined {
    return this.estimates.get(this.key(this.effort));
  }

  reset(): void {
    this.estimates.clear();
    this.#tasks.clear();
    this.run = null;
    this.error = null;
  }

  /** `POST /gen/estimate` × 3 in parallel (fetch 0 when switching effort afterwards). */
  async loadEstimates(): Promise<void> {
    const ws = this.ws();
    if (!ws) return;
    const engine = this.engine;
    await Promise.all(
      EFFORTS.map(async (effort) => {
        try {
          const e = await this.api.call("POST /ws/:ws/gen/estimate", { params: { ws }, body: { effort, engine } });
          if (this.ws() === ws) this.estimates.set(this.key(effort, engine), e);
        } catch (err) {
          if (this.ws() === ws) this.error = MitoriError.from(err).toData();
        }
      }),
    );
  }

  setEffort(e: Effort, chosen = true): void {
    this.effort = e;
    if (chosen) this.effortChosen = true;
  }

  async setEngine(e: EngineId): Promise<void> {
    this.engine = e;
    if (!this.estimates.has(this.key(this.effort, e))) await this.loadEstimates();
  }

  /**
   * One click starts (D3): `POST /gen/runs {estimateId, confirm: true}`. An expired estimate (`E_PRECONDITION`)
   * re-estimates and returns `"refreshed"` so the card waits for a second click (AC-U21).
   */
  async start(opts: { notBefore?: string } = {}): Promise<"started" | "refreshed" | "failed"> {
    const ws = this.ws();
    const est = this.current();
    if (!ws || !est) return "failed";
    this.starting = true;
    this.error = null;
    try {
      const body: { estimateId: GenEstimate["id"]; confirm: true; notBefore?: string } = { estimateId: est.id, confirm: true };
      if (opts.notBefore) body.notBefore = opts.notBefore;
      this.run = await this.api.call("POST /ws/:ws/gen/runs", { params: { ws }, body, idempotencyKey: `gen-${est.id}` });
      return "started";
    } catch (err) {
      const e = MitoriError.from(err);
      if (e.code === "E_PRECONDITION" || e.code === "E_CONFLICT") {
        await this.loadEstimates();
        return "refreshed";
      }
      this.error = e.toData();
      return "failed";
    } finally {
      this.starting = false;
    }
  }

  async control(action: "pause" | "resume" | "cancel"): Promise<void> {
    const ws = this.ws();
    const run = this.run;
    if (!ws || !run) return;
    try {
      this.run = await this.api.call("POST /ws/:ws/gen/runs/:run/control", { params: { ws, run: run.id }, body: { action } });
    } catch (err) {
      this.error = MitoriError.from(err).toData();
    }
  }

  async prioritize(section: SectionId): Promise<boolean> {
    const ws = this.ws();
    if (!ws) return false;
    try {
      await this.api.call("POST /ws/:ws/gen/prioritize", { params: { ws }, body: { section } });
      return true;
    } catch {
      return false;
    }
  }

  async estimateSection(section: SectionId): Promise<GenEstimate | null> {
    const ws = this.ws();
    if (!ws) return null;
    try {
      const e = await this.api.call("POST /ws/:ws/gen/estimate", { params: { ws }, body: { effort: this.effort, scope: [section] } });
      this.sectionEstimates.set(section, e);
      return e;
    } catch (err) {
      this.error = MitoriError.from(err).toData();
      return null;
    }
  }

  async runSection(section: SectionId): Promise<boolean> {
    const ws = this.ws();
    const est = this.sectionEstimates.get(section);
    if (!ws || !est) return false;
    try {
      this.run = await this.api.call("POST /ws/:ws/gen/runs", { params: { ws }, body: { estimateId: est.id, confirm: true }, idempotencyKey: `gen-${est.id}` });
      this.sectionEstimates.delete(section);
      return true;
    } catch (err) {
      this.error = MitoriError.from(err).toData();
      return false;
    }
  }

  applyRun(r: GenRun): void {
    if (this.run && this.run.id !== r.id && r.startedAt && this.run.startedAt && r.startedAt < this.run.startedAt) return;
    this.run = r;
  }

  applyTask(t: GenTaskView): void {
    this.#tasks.set(t.id, t);
  }
}
