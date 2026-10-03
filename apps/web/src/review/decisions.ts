/**
 * Focus-unit decisions of the Review panel (ux.md §4.7.2, JUDGEMENT §6.7, Map K7). The panel opens on the whole
 * proposal (`focus: all`: ⌘⏎ accepts everything, ⌘⌫ rejects everything); `n` / `⇧N` walk the units (hunks, then
 * doc proposals) and then ⌘⏎ / ⌘⌫ decide only the focused unit and move on to the next undecided one. Once every
 * unit is decided the ONE accept call is built. Sensitive jobs (SEC-12) decide per FILE and never send `all`.
 * Pure over the contract's `ReviewDecisions` (the Map fields are mutated in place; callers bump a version).
 */
import type { AcceptReq, FileDiff, HunkId, ProposalId } from "@mitori/core";
import type { ReviewDecisions } from "../contract.ts";

export type Unit = { kind: "hunk"; id: HunkId; file: string } | { kind: "proposal"; id: ProposalId };

/** Review units in display order: hunks file by file, then the doc proposals. */
export function unitsOf(files: readonly FileDiff[], proposals: readonly ProposalId[]): Unit[] {
  const out: Unit[] = [];
  for (const f of files) for (const h of f.hunks) out.push({ kind: "hunk", id: h.id, file: f.path });
  for (const p of proposals) out.push({ kind: "proposal", id: p });
  return out;
}

function decisionOf(d: ReviewDecisions, u: Unit): "accept" | "reject" | undefined {
  return u.kind === "hunk" ? d.hunks.get(u.id) : d.proposals.get(u.id);
}

function indexOf(units: readonly Unit[], focus: ReviewDecisions["focus"]): number {
  if (focus.kind === "all") return -1;
  return units.findIndex((u) => u.kind === focus.kind && u.id === focus.id);
}

const focusOf = (u: Unit): ReviewDecisions["focus"] => (u.kind === "hunk" ? { kind: "hunk", id: u.id } : { kind: "proposal", id: u.id });

/** `n` / `⇧N`: next / previous unit (from `all`, `n` goes to the first and `⇧N` to the last). */
export function step(d: ReviewDecisions, units: readonly Unit[], dir: 1 | -1): void {
  if (units.length === 0) return;
  const i = indexOf(units, d.focus);
  const j = i < 0 ? (dir === 1 ? 0 : units.length - 1) : Math.max(0, Math.min(units.length - 1, i + dir));
  d.focus = focusOf(units[j] as Unit);
}

export function undecided(d: ReviewDecisions, units: readonly Unit[]): Unit[] {
  return units.filter((u) => decisionOf(d, u) === undefined);
}

/** Decide one unit (or every hunk of a file for `file:<path>`), then focus the next undecided unit. */
export function decide(d: ReviewDecisions, units: readonly Unit[], target: Unit | { kind: "file"; path: string }, v: "accept" | "reject"): void {
  const list = target.kind === "file" ? units.filter((u) => u.kind === "hunk" && u.file === target.path) : [target];
  for (const u of list) {
    if (u.kind === "hunk") d.hunks.set(u.id, v);
    else if (u.kind === "proposal") d.proposals.set(u.id, v);
  }
  const last = list[list.length - 1];
  const from = last ? indexOf(units, focusOf(last)) : -1;
  const rest = undecided(d, units);
  const next = rest.find((u) => units.indexOf(u) > from) ?? rest[0];
  if (next) d.focus = focusOf(next);
}

/** Undo one decision (clicking the same ✓ / ✕ again). */
export function clear(d: ReviewDecisions, u: Unit): void {
  if (u.kind === "hunk") d.hunks.delete(u.id);
  else d.proposals.delete(u.id);
}

export function focusedUnit(d: ReviewDecisions, units: readonly Unit[]): Unit | null {
  const i = indexOf(units, d.focus);
  return i < 0 ? null : (units[i] as Unit);
}

/** What the panel does once the user has decided (or asked for everything). */
export type Outcome = { kind: "pending"; decided: number; total: number } | { kind: "accept"; req: AcceptReq } | { kind: "reject" };

/** Every unit decided ⇒ the single call: all accepted → `all`, all rejected → deferred reject, mixed → lists. */
export function outcome(d: ReviewDecisions, units: readonly Unit[], opts: { sensitive: boolean; unverified: boolean }): Outcome {
  const total = units.length;
  const decided = total - undecided(d, units).length;
  if (decided < total) return { kind: "pending", decided, total };
  const hunks = units.filter((u): u is Extract<Unit, { kind: "hunk" }> => u.kind === "hunk");
  const props = units.filter((u): u is Extract<Unit, { kind: "proposal" }> => u.kind === "proposal");
  const accH = hunks.filter((u) => d.hunks.get(u.id) === "accept").map((u) => u.id);
  const rejH = hunks.filter((u) => d.hunks.get(u.id) === "reject").map((u) => u.id);
  const accP = props.filter((u) => d.proposals.get(u.id) === "accept").map((u) => u.id);
  if (accH.length === 0 && accP.length === 0) return { kind: "reject" };
  const all = rejH.length === 0 && !opts.sensitive;
  const req: AcceptReq = {
    accept: all ? "all" : accH,
    ...(rejH.length ? { reject: rejH } : {}),
    ...(accP.length ? { proposals: accP } : {}),
    ...(opts.unverified ? { acceptUnverified: true } : {}),
  };
  return { kind: "accept", req };
}

/** ⌥⌘⏎ / 「すべて採用」: everything at once (refused for sensitive jobs, which need per-file decisions). */
export function acceptAll(units: readonly Unit[], opts: { sensitive: boolean; unverified: boolean }): AcceptReq | null {
  if (opts.sensitive) return null;
  const proposals = units.filter((u) => u.kind === "proposal").map((u) => u.id as ProposalId);
  return { accept: "all", ...(proposals.length ? { proposals } : {}), ...(opts.unverified ? { acceptUnverified: true } : {}) };
}

/** True when a partial selection builds a tree H′ ≠ head (the server re-runs the gates on H′, UXP-05). */
export function isPartial(req: AcceptReq): boolean {
  return req.accept !== "all" || (req.reject?.length ?? 0) > 0;
}
