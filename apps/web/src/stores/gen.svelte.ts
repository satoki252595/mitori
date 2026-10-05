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
import type { ActionContext } from "../gen/actions.ts";

const loadActions = () => import("../gen/actions.ts");

export class GenState implements GenStore {
  effort = $state<Effort>("standard");
  /** True once the user picked an effort (the default no longer follows the estimates). */
  effortChosen = $state(false);
  engine = $state<EngineId>("claude-cli");
  engineChosen = false;
  estimates = new SvelteMap<string, GenEstimate>();
  run = $state.raw<GenRun | null>(null);
  #tasks = new SvelteMap<string, GenTaskView>();
  error = $state.raw<MitoriErrorData | null>(null);
  starting = $state(false);
  /** Section estimates of placeholders (first click fetches, second click runs, ux.md §4.3.10). */
  sectionEstimates = new SvelteMap<SectionId, GenEstimate>();
  private readonly api: ApiClient;
  private readonly ws: () => WorkspaceKey | null;
  #epoch = 0;

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

  #actionContext(): ActionContext | null {
    const ws = this.ws();
    const epoch = this.#epoch;
    return ws ? { store: this, api: this.api, ws, current: () => (this.#epoch === epoch ? this.ws() : null) } : null;
  }

  reset(): void {
    this.#epoch++;
    this.engineChosen = false;
    this.estimates.clear();
    this.sectionEstimates.clear();
    this.#tasks.clear();
    this.#hydrated = null;
    this.run = null;
    this.error = null;
    this.starting = false;
  }

  /** `POST /gen/estimate` × 3 in parallel (fetch 0 when switching effort afterwards). */
  async loadEstimates(): Promise<void> {
    const ctx = this.#actionContext();
    if (!ctx) return;
    const engine = this.engine;
    await (await loadActions()).loadEstimates(ctx, engine);
  }

  setEffort(e: Effort, chosen = true): void {
    this.effort = e;
    if (chosen) this.effortChosen = true;
  }

  async setEngine(e: EngineId): Promise<void> {
    this.engineChosen = true;
    this.engine = e;
    if (!this.estimates.has(this.key(this.effort, e))) await this.loadEstimates();
  }

  /**
   * One click starts (D3): `POST /gen/runs {estimateId, confirm: true}`. An expired estimate (`E_PRECONDITION`)
   * re-estimates and returns `"refreshed"` so the card waits for a second click (AC-U21).
   */
  async start(opts: { notBefore?: string } = {}): Promise<"started" | "refreshed" | "failed"> {
    const ctx = this.#actionContext();
    const est = this.current();
    if (!ctx || !est) return "failed";
    this.starting = true;
    this.error = null;
    try {
      return await (await loadActions()).start(ctx, est, opts);
    } catch (err) {
      if (ctx.current() === ctx.ws) this.error = MitoriError.from(err).toData();
      return "failed";
    } finally {
      if (ctx.current() === ctx.ws) this.starting = false;
    }
  }

  async control(action: "pause" | "resume" | "cancel"): Promise<void> {
    const ctx = this.#actionContext();
    const run = this.run;
    if (!ctx || !run) return;
    await (await loadActions()).control(ctx, run, action);
  }

  async prioritize(section: SectionId): Promise<boolean> {
    const ctx = this.#actionContext();
    return ctx ? (await loadActions()).prioritize(ctx, section) : false;
  }

  async estimateSection(section: SectionId): Promise<GenEstimate | null> {
    const ctx = this.#actionContext();
    const effort = this.effort;
    return ctx ? (await loadActions()).estimateSection(ctx, section, effort) : null;
  }

  async runSection(section: SectionId): Promise<boolean> {
    const ctx = this.#actionContext();
    const est = this.sectionEstimates.get(section);
    return ctx && est ? (await loadActions()).runSection(ctx, section, est) : false;
  }

  applyRun(r: GenRun): void {
    if (this.run && this.run.id !== r.id && r.startedAt && this.run.startedAt && r.startedAt < this.run.startedAt) return;
    this.run = r;
    if (r.state !== "done" && r.state !== "failed" && r.state !== "cancelled") void this.#hydrate(r.id);
  }

  applyTask(t: GenTaskView): void {
    this.#tasks.set(t.id, t);
  }

  #hydrated: string | null = null;
  /**
   * A run seen for the first time (page opened mid-run, reconnect): its tasks so far come from
   * `GET /gen/runs/:run` — SSE `gen.task` only carries the changes after that. Once per run; an SSE update that
   * arrived meanwhile wins over the snapshot.
   */
  async #hydrate(run: GenRun["id"]): Promise<void> {
    const ws = this.ws();
    if (!ws || this.#hydrated === run) return;
    this.#hydrated = run;
    try {
      const d = await this.api.call("GET /ws/:ws/gen/runs/:run", { params: { ws, run } });
      if (this.ws() !== ws || this.run?.id !== run) return;
      for (const t of d.tasks) if (!this.#tasks.has(t.id)) this.#tasks.set(t.id, t);
    } catch {
      this.#hydrated = null;
    }
  }
}
