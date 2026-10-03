/**
 * Generation progress (ux.md §4.2.5): counters from CONFIRMED usage only (never decreasing, no time-based %),
 * one row per stage (`done / total`), the tail line. Pure.
 */
import type { GenRun, GenStage, GenTaskView } from "@mitori/core";

export interface StageProgress {
  stage: GenStage;
  done: number;
  total: number;
  running: number;
  failed: number;
}

const DONE = new Set(["done", "cached", "skipped"]);
const ORDER: readonly GenStage[] = ["S5", "S6", "S6o", "S7", "S8", "S9", "translate", "simplify"];

export function stageProgress(tasks: readonly GenTaskView[]): StageProgress[] {
  const by = new Map<GenStage, StageProgress>();
  for (const t of tasks) {
    let p = by.get(t.stage);
    if (!p) {
      p = { stage: t.stage, done: 0, total: 0, running: 0, failed: 0 };
      by.set(t.stage, p);
    }
    p.total++;
    if (DONE.has(t.state)) p.done++;
    else if (t.state === "failed") p.failed++;
    else if (t.state === "running" || t.state === "validating" || t.state === "retrying") p.running++;
  }
  return ORDER.flatMap((s) => {
    const p = by.get(s);
    return p ? [p] : [];
  });
}

export type StageStatus = "done" | "running" | "waiting" | "failed";

export interface StageRow extends StageProgress {
  status: StageStatus;
  /** Confirmed tokens of the stage's finished tasks (all input classes + output). */
  used: number;
  /** Planned tokens of the stage (estimate). */
  planned: number;
}

const taskTokens = (t: Pick<GenTaskView, "usage">) => (t.usage ? t.usage.in + t.usage.cacheRead + t.usage.cacheWrite + t.usage.out : 0);

/**
 * Stage list of the progress card (prototype `01c-generating`): one row per planned stage in the estimate's order,
 * `✓` when every task finished, `◐` while one runs, `○` before, `✕` when a task failed and nothing runs.
 */
export function stageRowsLive(run: Pick<GenRun, "estimate">, tasks: readonly GenTaskView[]): StageRow[] {
  const prog = new Map(stageProgress(tasks).map((p) => [p.stage, p]));
  const used = new Map<GenStage, number>();
  for (const t of tasks) used.set(t.stage, (used.get(t.stage) ?? 0) + taskTokens(t));
  const planned = new Map(run.estimate.stages.map((s) => [s.stage, s]));
  const order = [...run.estimate.stages.map((s) => s.stage), ...[...prog.keys()].filter((s) => !planned.has(s))];
  return order.map((stage) => {
    const p = prog.get(stage) ?? { stage, done: 0, total: planned.get(stage)?.tasks ?? 0, running: 0, failed: 0 };
    const total = Math.max(p.total, planned.get(stage)?.tasks ?? 0);
    const status: StageStatus =
      p.running > 0
        ? "running"
        : total > 0 && p.done >= total
          ? "done"
          : p.failed > 0 && p.done + p.failed >= total
            ? "failed"
            : p.done > 0
              ? "running"
              : "waiting";
    const pl = planned.get(stage);
    return { ...p, total, status, used: used.get(stage) ?? 0, planned: pl ? pl.inTokens + pl.outTokens : 0 };
  });
}

/** Finished share of the run's tasks (0–1; tasks, never time). */
export function runShare(run: Pick<GenRun, "progress">): number {
  const { total, done, failed } = run.progress;
  return total > 0 ? Math.min(1, (done + failed) / total) : 0;
}

export interface Counters {
  inTokens: number;
  outTokens: number;
  usd: number;
}

/** Totals of the run's confirmed usage; `prev` keeps every counter monotone (AC-U23). */
export function runCounters(run: Pick<GenRun, "usage">, prev: Counters | null): Counters {
  const u = run.usage;
  const now = { inTokens: u.in + u.cacheRead + u.cacheWrite, outTokens: u.out, usd: u.apiUsd };
  if (!prev) return now;
  return { inTokens: Math.max(prev.inTokens, now.inTokens), outTokens: Math.max(prev.outTokens, now.outTokens), usd: Math.max(prev.usd, now.usd) };
}

/** Elapsed ms since the run started (0 before it starts). */
export function elapsedMs(run: Pick<GenRun, "startedAt" | "finishedAt">, nowMs: number): number {
  if (!run.startedAt) return 0;
  const end = run.finishedAt ? Date.parse(run.finishedAt) : nowMs;
  return Math.max(0, end - Date.parse(run.startedAt));
}

export function isActive(run: Pick<GenRun, "state"> | null): boolean {
  return !!run && (run.state === "running" || run.state === "paused" || run.state === "estimating" || run.state === "awaiting_confirm");
}

/** Module ids (diagram rooms) being generated / done, from module-target tasks. */
export function roomTargets(tasks: readonly GenTaskView[]): { generating: Set<string>; done: Set<string> } {
  const generating = new Set<string>();
  const done = new Set<string>();
  for (const t of tasks) {
    if (t.target.kind !== "module" && t.target.kind !== "parent") continue;
    if (DONE.has(t.state)) done.add(t.target.id);
    else if (t.state === "running" || t.state === "validating" || t.state === "retrying" || t.state === "ready") generating.add(t.target.id);
  }
  return { generating, done };
}

/**
 * Streaming reservation H_est (ux.md §4.3.9): clamp(outTokens × cpt / cpl × lh, 120, 2400) px;
 * cpt = chars per token (ja 1.25 / en 2.87), cpl = chars per line (37 / 70), lh = 30.4 px. No estimate ⇒ 600.
 */
export function reservePx(outTokens: number | undefined, lang: "ja" | "en"): number {
  if (outTokens === undefined || !(outTokens > 0)) return 600;
  const cpt = lang === "ja" ? 1.25 : 2.87;
  const cpl = lang === "ja" ? 37 : 70;
  return Math.round(Math.min(2400, Math.max(120, ((outTokens * cpt) / cpl) * 30.4)));
}
