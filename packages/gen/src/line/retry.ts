/**
 * The single retry (gen spec §6.4, ADR-0011 R1). A retry is planned after attempt 1 when a line was rejected,
 * a required aspect / the module line / the minimum flow count is missing, or the reply was truncated.
 * Warnings alone never retry. Many errors (> 50 % of block lines and ≥ 6) resend the whole prompt instead.
 * `previous` stays empty here: only the caller has the raw lines, and only the claude-cli cold path sends them.
 */
import { type CoverageReport, GEN_LIMITS, type GenLine, type LineVerdict, type RetryPlan } from "../contract.ts";

/** Decide whether to retry (null ⇒ no retry). */
export function planRetryImpl(verdicts: readonly LineVerdict[], coverage: CoverageReport, attempt: 1 | 2): RetryPlan | null {
  if (attempt !== 1) return null;
  const rejected = verdicts.filter((v) => v.errors.length > 0);
  if (rejected.length === 0 && coverage.ok) return null;
  const blockLines = coverage.blocks + rejected.length;
  const whole = rejected.length >= GEN_LIMITS.wholeRetryMinErrors && rejected.length > GEN_LIMITS.wholeRetryErrorShare * blockLines;
  const errors = rejected.flatMap((v) => v.errors).slice(0, GEN_LIMITS.retryErrorsShown);
  const missing: string[] = [];
  // a flow aspect names its flow and section, so the fix lands under that flow (not the last one written)
  const gaps = coverage.flowGaps ?? [];
  for (const a of coverage.missingAspects) {
    const of = gaps.filter((g) => g.aspect === a);
    if (of.length === 0) missing.push(`aspect ${a}`);
    else for (const g of of) missing.push(`aspect ${a} of flow ${g.key} (a block with "section":"s3/${g.key}")`);
  }
  if (coverage.moduleLineMissing) missing.push("module line");
  // `ok` is false with nothing else missing ⇒ fewer flow lines than the task's minimum.
  if (!coverage.ok && coverage.missingAspects.length === 0 && !coverage.moduleLineMissing && !coverage.truncated)
    missing.push(`more flow lines (${coverage.flows} written)`);
  for (const id of coverage.unaccounted) missing.push(`id ${id}`);
  if (coverage.truncated) {
    const last = [...verdicts].reverse().find((v) => v.value !== undefined && v.value.t !== "end")?.value;
    missing.push(last ? `continue after ${describe(last)}` : "continue from the start");
  }
  return { kind: whole ? "whole" : "diff", errors, previous: [], missing };
}

/** One-line description of an accepted line (MISSING `continue after …`). */
export function describe(line: GenLine): string {
  switch (line.t) {
    case "block": {
      const text = line.md
        .replace(/\[\[[0-9]+\]\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return `block ${line.id} aspect=${line.aspect ?? "-"}: ${text.slice(0, 60)}`;
    }
    case "module":
      return `module ${line.module}`;
    case "flow":
      return `flow ${line.key}`;
    case "term":
      return `term ${line.term}`;
    case "question":
      return `question: ${line.text.slice(0, 60)}`;
    case "keep":
    case "delete":
      return `${line.t} ${line.id}`;
    case "verdict":
      return `verdict ${line.claim}`;
    case "end":
      return "end";
  }
}
