/** First-use API actions. GenState keeps synchronous SSE state and captures the workspace before importing this. */
import type { ApiClient } from "@mitori/client";
import { type Effort, type EngineId, type GenEstimate, type GenRun, MitoriError, type SectionId, type WorkspaceKey } from "@mitori/core";
import type { GenState } from "../stores/gen.svelte.ts";
import { EFFORTS } from "./efforts.ts";

export interface ActionContext {
  store: GenState;
  api: ApiClient;
  ws: WorkspaceKey;
  current: () => WorkspaceKey | null;
}

export async function loadEstimates({ store, api, ws, current }: ActionContext, engine: EngineId): Promise<void> {
  if (current() !== ws) return;
  await Promise.all(
    EFFORTS.map(async (effort) => {
      try {
        const e = await api.call("POST /ws/:ws/gen/estimate", { params: { ws }, body: { effort, engine } });
        if (current() === ws) store.estimates.set(store.key(effort, engine), e);
      } catch (err) {
        if (current() === ws) store.error = MitoriError.from(err).toData();
      }
    }),
  );
}

export async function start(ctx: ActionContext, est: GenEstimate, opts: { notBefore?: string }): Promise<"started" | "refreshed" | "failed"> {
  const { store, api, ws, current } = ctx;
  if (current() !== ws) return "failed";
  try {
    const body: { estimateId: GenEstimate["id"]; confirm: true; notBefore?: string } = { estimateId: est.id, confirm: true };
    if (opts.notBefore) body.notBefore = opts.notBefore;
    const run = await api.call("POST /ws/:ws/gen/runs", { params: { ws }, body, idempotencyKey: `gen-${est.id}` });
    if (current() !== ws) return "failed";
    store.run = run;
    return "started";
  } catch (err) {
    if (current() !== ws) return "failed";
    const e = MitoriError.from(err);
    if (e.code === "E_PRECONDITION" || e.code === "E_CONFLICT") {
      await store.loadEstimates();
      return current() === ws ? "refreshed" : "failed";
    }
    store.error = e.toData();
    return "failed";
  }
}

export async function control({ store, api, ws, current }: ActionContext, run: GenRun, action: "pause" | "resume" | "cancel"): Promise<void> {
  if (current() !== ws) return;
  try {
    const result = await api.call("POST /ws/:ws/gen/runs/:run/control", { params: { ws, run: run.id }, body: { action } });
    if (current() === ws) store.run = result;
  } catch (err) {
    if (current() === ws) store.error = MitoriError.from(err).toData();
  }
}

export async function prioritize({ api, ws, current }: ActionContext, section: SectionId): Promise<boolean> {
  if (current() !== ws) return false;
  try {
    await api.call("POST /ws/:ws/gen/prioritize", { params: { ws }, body: { section } });
    return current() === ws;
  } catch {
    return false;
  }
}

export async function estimateSection({ store, api, ws, current }: ActionContext, section: SectionId, effort: Effort): Promise<GenEstimate | null> {
  if (current() !== ws) return null;
  try {
    const e = await api.call("POST /ws/:ws/gen/estimate", { params: { ws }, body: { effort, scope: [section] } });
    if (current() !== ws) return null;
    store.sectionEstimates.set(section, e);
    return e;
  } catch (err) {
    if (current() === ws) store.error = MitoriError.from(err).toData();
    return null;
  }
}

export async function runSection({ store, api, ws, current }: ActionContext, section: SectionId, est: GenEstimate): Promise<boolean> {
  if (current() !== ws) return false;
  try {
    const run = await api.call("POST /ws/:ws/gen/runs", { params: { ws }, body: { estimateId: est.id, confirm: true }, idempotencyKey: `gen-${est.id}` });
    if (current() !== ws) return false;
    store.run = run;
    store.sectionEstimates.delete(section);
    return true;
  } catch (err) {
    if (current() === ws) store.error = MitoriError.from(err).toData();
    return false;
  }
}
