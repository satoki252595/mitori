/** `mitori.prep/1` packet files (gen spec §8.4.2, R1 PT-10): README (byte-fixed template), tasks.json, batches.json. */
import type { GenTaskId } from "@mitori/core";
import { GEN_ESTIMATE_PARAMS, PREP_README_LINES, type PrepTaskEntry } from "../contract.ts";

/** README.md of a packet. */
export function renderReadme(v: {
  prepId: string;
  phase: number;
  docDir: string;
  dir: string;
  expiresAt: string;
  tasks: number;
  inTokens: number;
  outTokens: number;
}): string {
  const vars: Record<string, string> = {
    prep_id: v.prepId,
    phase: String(v.phase),
    doc_dir: v.docDir,
    dir: v.dir,
    expires_at: v.expiresAt,
    tasks: String(v.tasks),
    in_k: String(Math.max(1, Math.round(v.inTokens / 1000))),
    out_k: String(Math.max(1, Math.round(v.outTokens / 1000))),
  };
  return `${PREP_README_LINES.map((l) => l.replace(/\{\{([a-z_]+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)).join("\n")}\n`;
}

/** Group same-phase tasks into subagent batches (≤ `batchSize` tasks and ≤ 100k input tokens each). */
export function batchesOf(tasks: readonly PrepTaskEntry[], batchSize: number = GEN_ESTIMATE_PARAMS.sessionBatchTasks): { batch: number; tasks: GenTaskId[] }[] {
  const out: { batch: number; tasks: GenTaskId[]; in: number }[] = [];
  for (const t of tasks) {
    const last = out.at(-1);
    if (!last || last.tasks.length >= batchSize || last.in + t.estimate.in > GEN_ESTIMATE_PARAMS.sessionBatchMaxInTokens)
      out.push({ batch: out.length + 1, tasks: [], in: 0 });
    const b = out.at(-1) as (typeof out)[number];
    b.tasks.push(t.id);
    b.in += t.estimate.in;
  }
  return out.map(({ batch, tasks: ids }) => ({ batch, tasks: ids }));
}
