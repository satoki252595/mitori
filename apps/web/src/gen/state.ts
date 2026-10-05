import type { GenRun, GenTaskView } from "@mitori/core";

const DONE = new Set(["done", "cached", "skipped"]);

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
