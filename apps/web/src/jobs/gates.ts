/**
 * Gate verdict presentation (ux.md §4.7 R1, UXP-05, AC-U-G01/G02). ✓ only when every gate that applies passed ON
 * THE TREE BEING APPLIED (`Job.gateVerdict === "passed"`); skipped / untrusted / waiting-for-consent gates make the
 * verdict 「⚠ 検査なし（未承認 n 件）」, a partial accept whose combination is still being re-checked shows
 * 「組み合わせを検査中…」, and a failed combination turns the main button into the warning-coloured
 * 「検査に失敗した組み合わせを採用」 (sent with `acceptUnverified`). Pure.
 */
import type { GateResult, GateVerdict } from "@mitori/core";

/** The gate fields of a job (readonly views are fine). */
export interface GateFields {
  gates: readonly GateResult[];
  gateVerdict?: GateVerdict | undefined;
}

export type GateBadge =
  /** All gates passed on the applied tree. */
  | { kind: "passed"; pass: number; total: number }
  /** Some gate failed (or errored / timed out). */
  | { kind: "failed"; pass: number; total: number }
  /** Not checked: n gates are untrusted / skipped / waiting for the 「自動検査を実行」 click. */
  | { kind: "unverified"; unchecked: number; pending: number; total: number }
  /** Partial accept: the combination H′ is being re-checked. */
  | { kind: "rechecking"; total: number }
  /** The job declared no gates. */
  | { kind: "none" };

const UNCHECKED: ReadonlySet<GateResult["status"]> = new Set(["skipped", "untrusted", "pending_consent"]);
const BAD: ReadonlySet<GateResult["status"]> = new Set(["fail", "error", "timeout"]);

/** Verdict when the server did not send one (older job rows): computed from the last attempt's gate results. */
export function verdictOf(gates: readonly GateResult[], explicit: GateVerdict | undefined): GateVerdict | null {
  if (explicit) return explicit;
  if (gates.length === 0) return null;
  if (gates.some((g) => BAD.has(g.status))) return "failed";
  if (gates.some((g) => UNCHECKED.has(g.status))) return "unverified";
  return "passed";
}

export function gateBadge(job: GateFields): GateBadge {
  const gates = job.gates;
  const total = gates.length;
  const pass = gates.filter((g) => g.status === "pass").length;
  const v = verdictOf(gates, job.gateVerdict);
  if (v === null) return { kind: "none" };
  if (v === "passed") return { kind: "passed", pass, total };
  if (v === "failed") return { kind: "failed", pass, total };
  if (v === "partial_unverified") return { kind: "rechecking", total };
  return {
    kind: "unverified",
    unchecked: gates.filter((g) => g.status === "skipped" || g.status === "untrusted").length,
    pending: gates.filter((g) => g.status === "pending_consent").length,
    total,
  };
}

/** The accept button has to say what is being accepted when the tree is not verified (UXP-05). */
export function acceptNeedsWarning(job: GateFields): "none" | "unverified" | "failed" {
  const b = gateBadge(job);
  if (b.kind === "failed") return "failed";
  if (b.kind === "unverified" || b.kind === "rechecking") return "unverified";
  return "none";
}

/** Gate id → short label: `fmt:gofmt` → `gofmt`, `test:go` → `go test`. */
export function gateLabel(id: string): string {
  const [kind, name = id] = id.split(":");
  if (kind === "test" && !/test/.test(name)) return `${name} test`;
  if (kind === "build" && !/build/.test(name)) return `${name} build`;
  if (kind === "typecheck" && !/check|tsc|vet/.test(name)) return `${name} check`;
  return name;
}

/** 「空白だけの変更 {n} 行」: lines a formatter rewrote (summary must include it, Editorial §8-6). */
export function autofixedLines(gates: readonly GateResult[]): number {
  return gates.reduce((n, g) => n + (g.autofixedLines ?? 0), 0);
}
