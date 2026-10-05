/** Read-only Pass 1 token efficiency from a real generation report, with its captured source baseline. */
import { INCLUDED_CLASSES } from "@mitori/core";
import type { SuiteResult } from "./report.ts";
import { type SloEntry, sloEntry } from "./slo.ts";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as ObjectValue) : {});
const amount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const sha = (v: unknown): v is string => typeof v === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{16}$/.test(v);

export interface TokenEfficiency {
  label: string;
  status: "measured" | "unmeasured";
  reason?: string;
  sha?: string;
  indexDigest?: string;
  pass1In?: number;
  filteredTokens?: number;
  inputFiltered?: number;
  numerator: "provider" | "estimated" | "unknown";
  /** FileEntry.tokensEst is always an estimate, even when provider usage is exact. */
  denominator: "estimated";
  estimatedCalls?: number;
}

/** Missing or mismatched provenance never borrows a denominator from the current checkout. */
export function tokenEfficiency(value: unknown, label: string): TokenEfficiency {
  const r = object(value);
  const run = object(r.run);
  const base = object(r.tokenBaseline);
  const source = object(r.sourceSnapshot);
  const pinned = object(run.pinned);
  const unavailable = (reason: string): TokenEfficiency => ({ label, status: "unmeasured", reason, numerator: "unknown", denominator: "estimated" });
  if (r.v !== "mitori.gen-real/1") return unavailable("not a real generation report");
  if (r.effort !== "standard" || run.effort !== "standard") return unavailable("requires a standard Pass 1 run");
  if (!Array.isArray(run.scope) || run.scope.length !== 0 || run.trigger !== "user")
    return unavailable("scoped, incremental or on-demand generation is not full Pass 1");
  if (run.state !== "done") return unavailable("run is incomplete");
  const started = typeof run.startedAt === "string" ? Date.parse(run.startedAt) : Number.NaN;
  const finished = typeof run.finishedAt === "string" ? Date.parse(run.finishedAt) : Number.NaN;
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return unavailable("missing or invalid run timestamps");
  if (base.v !== "mitori.token-baseline/1") return unavailable("filtered baseline was not captured by this report");
  if (!sha(source.sha) || !sha(base.sha) || source.sha !== base.sha) return unavailable("missing or mismatched source SHA");
  if (!digest(source.indexDigest) || !digest(base.indexDigest) || source.indexDigest !== base.indexDigest || pinned.snapshot !== base.indexDigest)
    return unavailable("missing or mismatched pinned indexDigest");
  if (base.tokenizer !== "claude-v5" || base.estimated !== true) return unavailable("unknown denominator estimator");
  if (
    !Array.isArray(base.includedClasses) ||
    !base.includedClasses.every((v) => typeof v === "string") ||
    [...base.includedClasses].sort().join("|") !== [...INCLUDED_CLASSES].sort().join("|")
  )
    return unavailable("baseline does not use INCLUDED_CLASSES");
  if (!amount(base.filteredTokens) || base.filteredTokens === 0) return unavailable("missing or zero filtered token denominator");
  if (!Array.isArray(r.tasks) || r.tasks.length === 0 || !Array.isArray(r.records)) return unavailable("missing tasks or usage ledger");
  const tasks = r.tasks.map(object);
  if (tasks.some((t) => typeof t.id !== "string" || t.state === "cached")) return unavailable("cached or unidentified tasks do not describe a fresh Pass 1");
  if (object(run.progress).total !== tasks.length || tasks.some((t) => !["done", "skipped"].includes(String(t.state))))
    return unavailable("missing or incomplete run tasks");
  if (object(run.progress).failed !== 0) return unavailable("failed or unidentified run task count");
  const ids = new Set(tasks.map((t) => t.id));
  const seen = new Set<string>();
  const recordedInputs = new Map<string, number>();
  let input = 0;
  let estimatedCalls = 0;
  for (const raw of r.records) {
    const record = object(raw);
    const scope = object(record.scope);
    if (scope.kind !== "gen_task" || !ids.has(scope.id)) continue;
    // Task ids are stable across runs; collectRun also includes a five-second look-back.
    const at = typeof record.at === "string" ? Date.parse(record.at) : Number.NaN;
    if (!Number.isFinite(at)) return unavailable("missing or invalid ledger timestamp");
    if (at < started || at > finished) continue;
    if (typeof record.id !== "string" || seen.has(record.id)) return unavailable("missing or duplicate usage record id");
    seen.add(record.id);
    const usage = object(record.usage);
    if (![usage.in, usage.cacheWrite, usage.cacheRead].every(amount)) return unavailable("missing or invalid input usage");
    if (typeof record.usageEstimated !== "boolean") return unavailable("unknown usage provenance");
    const callInput = (usage.in as number) + (usage.cacheWrite as number) + (usage.cacheRead as number);
    input += callInput;
    recordedInputs.set(scope.id as string, (recordedInputs.get(scope.id as string) ?? 0) + callInput);
    if (record.usageEstimated === true) estimatedCalls++;
  }
  if (seen.size === 0) return unavailable("no ledger calls for this run's tasks");
  if (tasks.some((t) => t.state === "done" && !(Number(recordedInputs.get(t.id as string)) > 0)))
    return unavailable("completed task is missing positive ledger input");
  if (!Number.isFinite(input) || input === 0) return unavailable("input usage sum is invalid or zero");
  return {
    label,
    status: "measured",
    sha: base.sha,
    indexDigest: base.indexDigest,
    pass1In: input,
    filteredTokens: base.filteredTokens,
    inputFiltered: input / base.filteredTokens,
    numerator: estimatedCalls > 0 ? "estimated" : "provider",
    denominator: "estimated",
    estimatedCalls,
  };
}

export function offlineTokens(reports: readonly { label: string; value: unknown }[]): {
  result: SuiteResult;
  slo: SloEntry[];
  measurements: TokenEfficiency[];
} {
  const measurements = reports.map(({ label, value }) => tokenEfficiency(value, label));
  const result: SuiteResult = {
    id: "tokens",
    status: "ok",
    checks: [],
    metrics: {},
    notes: ["Offline report analysis: no engine detection or model call; every filtered denominator and ratio is estimated."],
  };
  const slo: SloEntry[] = [];
  for (const [i, m] of measurements.entries()) {
    if (m.status === "unmeasured") {
      result.notes.push(`${m.label}: unmeasured — ${m.reason}`);
      continue;
    }
    const ratio = m.inputFiltered as number;
    const entry = { ...sloEntry("gen.ratio.inputFiltered", { value: ratio }), estimated: true, context: m.label };
    slo.push(entry);
    result.metrics[`report.${i}.pass1In`] = m.pass1In as number;
    result.metrics[`report.${i}.filteredTokens`] = m.filteredTokens as number;
    result.metrics[`report.${i}.inputFiltered`] = ratio;
    result.metrics[`report.${i}.estimatedCalls`] = m.estimatedCalls as number;
    result.checks.push({
      id: `inputFiltered:${m.label}`,
      ok: entry.status !== "red",
      detail: `estimated ${ratio.toFixed(4)}; target ${entry.target}, limit ${entry.limit}; numerator ${m.numerator}, denominator estimated`,
    });
    result.notes.push(
      `${m.label}: SHA ${m.sha}, indexDigest ${m.indexDigest}; numerator ${m.numerator} (${m.estimatedCalls} estimated calls), denominator FileEntry.tokensEst (claude-v5).`,
    );
  }
  if (result.checks.some((check) => !check.ok)) result.status = "failed";
  else if (measurements.some((m) => m.status === "unmeasured") || measurements.length === 0) result.status = "partial";
  return { result, slo, measurements };
}
