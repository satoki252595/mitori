// Claim bookkeeping for the store: verdicts, marker canonicalization, link-group ↔ claim matching (§10.3).
import type { BlockLock, Cite, Claim, ClaimChecks, Iso8601, Verdict } from "@mitori/core";
import { markerPositions } from "../codec/cite.ts";
import type { CiteLinkGroup } from "../contract.ts";

/**
 * Verdict of a claim [UXP-06] (core `Verdict` doc wins over gen §7.2): human-verified > stale (L2) > unsupported
 * (L0 false, L3 U, or L1 fail without L3 S) > inferred (no cite, L3 P) > cited (L1 vacuous) > verified.
 */
export function verdictOf(checks: ClaimChecks, cites: readonly Cite[], lock: BlockLock | undefined): Verdict {
  if (lock === "human-verified") return "human-verified";
  if (cites.length > 0 && !checks.l2) return "stale";
  if (!checks.l0 || checks.l3 === "U") return "unsupported";
  if (cites.length === 0) return "inferred";
  if (checks.l1 === "fail" && checks.l3 !== "S") return "unsupported";
  if (checks.l3 === "P") return "inferred";
  if (checks.l1 === "vacuous") return "cited";
  return "verified";
}

/** Checks of a cite parsed from Markdown that has not been stamped yet (re-stamped right after). */
export function pendingChecks(at: Iso8601): ClaimChecks {
  return { l0: true, l1: "vacuous", l2: true, checkedAt: at };
}

/** A cite as written in Markdown (path/range only) before the stamper fills blob/snippet. */
export function rawCite(c: { path: string; start: number; end: number }): Cite {
  return { path: c.path, start: c.start, end: c.end, blob: "", snippet: "", precision: "search" };
}

/**
 * Renumber markers by occurrence (`[[k]]` ↔ k-th claim) — the store's canonical marker form. Returns the new md and,
 * per occurrence, the original marker number.
 */
export function canonicalMarkers(md: string): { md: string; order: number[] } {
  const marks = markerPositions(md);
  if (marks.length === 0) return { md, order: [] };
  let out = "";
  let at = 0;
  marks.forEach((m, i) => {
    out += `${md.slice(at, m.start)}[[${i + 1}]]`;
    at = m.end;
  });
  return { md: out + md.slice(at), order: marks.map((m) => m.n) };
}

const citeKey = (c: { path: string; start: number; end: number }) => `${c.path}:${c.start}-${c.end}`;
const setKey = (cs: readonly { path: string; start: number; end: number }[]) => cs.map(citeKey).sort().join(",");

/**
 * Match link groups (in order) to existing claims (in order). Loading (§10.3): positional when the counts agree
 * (re-anchored line numbers), otherwise by equal cite sets, then by any shared cite. Human edits (`positional:
 * false`): cite sets only — a replaced link drops its claim (UXP-20). Returns per group the matched claim (or null
 * = new claim) and the dropped ones.
 */
export function matchGroups(groups: readonly CiteLinkGroup[], old: readonly Claim[], positional = true): { matched: (Claim | null)[]; dropped: Claim[] } {
  if (positional && groups.length === old.length) return { matched: [...old], dropped: [] };
  const free = new Set(old);
  const matched: (Claim | null)[] = groups.map(() => null);
  const pass = (pred: (g: CiteLinkGroup, c: Claim) => boolean) => {
    groups.forEach((g, i) => {
      if (matched[i]) return;
      for (const c of free) {
        if (pred(g, c)) {
          matched[i] = c;
          free.delete(c);
          return;
        }
      }
    });
  };
  pass((g, c) => setKey(g.cites) === setKey(c.cites));
  pass((g, c) => g.cites.some((x) => c.cites.some((y) => citeKey(x) === citeKey(y))));
  return { matched, dropped: [...free] };
}

/** True when the group's ranges equal the claim's (no re-stamp needed). */
export const sameRanges = (g: CiteLinkGroup, cites: readonly Cite[]): boolean => setKey(g.cites) === setKey(cites);
