/**
 * Finish(push) partition (loop spec §2.4.3): question/review/note ⇒ one job each; change/doc_edit ⇒ leaf-module
 * bundles, merged by intersecting write scopes (union-find), cut greedily by BATCH_LIMITS, later cuts of the same
 * component locked after earlier ones that share files. Independent of input order.
 */
import { INTENT_JOB_KIND, type RepoPath, type ThreadDetail } from "@mitori/core";
import { BATCH_LIMITS, type BatchJobPlan } from "../contract.ts";

interface Ctx {
  moduleOf(path: RepoPath): string;
  writeScopeOf(t: ThreadDetail): RepoPath[];
  anchoredLinesOf(t: ThreadDetail): number;
}

/** Primary path + line of a thread (doc-primary: first write-scope path). */
function keyOf(t: ThreadDetail, scope: readonly RepoPath[]): [string, number] {
  const c = t.anchor.code;
  if (c) return [c.path, c.start];
  return [scope[0] ?? "", 0];
}

function cmp(a: [string, number, string], b: [string, number, string]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}

const intersects = (a: readonly RepoPath[], b: readonly RepoPath[]) => a.some((p) => b.includes(p));

/** {@link planBatch} implementation. */
export function planPartitions(threads: ThreadDetail[], ctx: Ctx): BatchJobPlan[] {
  const info = threads.map((t) => {
    const scope = [...new Set(ctx.writeScopeOf(t))].sort();
    const [path, line] = keyOf(t, scope);
    return { t, scope, key: [path, line, t.id] as [string, number, string], lines: ctx.anchoredLinesOf(t) };
  });
  info.sort((a, b) => cmp(a.key, b.key));

  const plans: BatchJobPlan[] = [];
  const fix = info.filter((x) => INTENT_JOB_KIND[x.t.intent] === "fix");
  for (const x of info) {
    const kind = INTENT_JOB_KIND[x.t.intent];
    if (kind !== "fix") plans.push({ threads: [x.t.id], kind, writeScope: [], after: [] });
  }

  // Union-find over module bundles and intersecting write scopes.
  const parent = fix.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const byModule = new Map<string, number>();
  fix.forEach((x, i) => {
    const mod = ctx.moduleOf(x.key[0]);
    const first = byModule.get(mod);
    if (first === undefined) byModule.set(mod, i);
    else union(first, i);
    for (let j = 0; j < i; j++) if (intersects(x.scope, (fix[j] as (typeof fix)[number]).scope)) union(i, j);
  });
  const comps = new Map<number, typeof fix>();
  fix.forEach((x, i) => {
    const r = find(i);
    const list = comps.get(r);
    if (list) list.push(x);
    else comps.set(r, [x]);
  });

  for (const members of [...comps.keys()].sort((a, b) => a - b).map((r) => comps.get(r) as typeof fix)) {
    const first = plans.length;
    let cur: typeof fix = [];
    const flush = () => {
      if (cur.length === 0) return;
      const writeScope = [...new Set(cur.flatMap((x) => x.scope))].sort();
      const after: number[] = [];
      for (let j = first; j < plans.length; j++) if (intersects(writeScope, (plans[j] as BatchJobPlan).writeScope)) after.push(j);
      plans.push({ threads: cur.map((x) => x.t.id), kind: "fix", writeScope, after });
      cur = [];
    };
    for (const x of members) {
      const lines = cur.reduce((s, y) => s + y.lines, 0) + x.lines;
      const files = new Set([...cur.flatMap((y) => y.scope), ...x.scope]).size;
      if (cur.length > 0 && (cur.length + 1 > BATCH_LIMITS.threads || lines > BATCH_LIMITS.anchoredLines || files > BATCH_LIMITS.files)) flush();
      cur.push(x);
    }
    flush();
  }
  return plans;
}
