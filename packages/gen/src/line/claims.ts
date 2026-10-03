/**
 * Claims of a block line: the compact map (R1 default, PT-03) and the full object form, both parsed into
 * {@link GenClaimDraft}[]. Grammar of one compact value: `<ClaimKind>[ <cite>(,<cite>)*]` with
 * `<cite> = <path>:<a>[-<b>]`; after a comma, a cite path without `/` reuses the previous cite's directory and a bare
 * range `<a>[-<b>]` reuses the previous cite's file (`a/b.go:10-20,40-52`; models write it unprompted, and it is the
 * shortest form) [dogfood 2026-10-04].
 */
import type { ClaimKind } from "@mitori/core";
import type { RawCite } from "@mitori/doc";
import type { GenClaimDraft } from "../contract.ts";

/** Claim kinds (gen.block/1 §6.2). */
export const CLAIM_KINDS: ReadonlySet<string> = new Set<ClaimKind>([
  "architecture",
  "behavior",
  "edge_case",
  "invariant",
  "risk",
  "performance",
  "security",
  "fact",
]);

/** A parse problem (always rule V03). */
export interface ClaimProblem {
  /** JSON-pointer-ish location under the line (`/claims/2`). */
  at: string;
  /** Expected. */
  expected: string;
  /** Found. */
  actual: string;
}

/** Parse result: drafts in marker order of appearance in `claims`, plus problems. */
export interface ParsedClaims {
  /** Drafts. */
  claims: GenClaimDraft[];
  /** Problems. */
  problems: ClaimProblem[];
  /** Unknown keys dropped inside full-form claim / cite objects (W02). */
  unknownKeys: number;
}

const CITE_RE = /^(.+):(\d+)(?:-(\d+))?$/;
const BARE_RANGE_RE = /^(\d+)(?:-(\d+))?$/;

/** Parse one compact claim value (`"behavior a/b.go:1-4,c.go:9"`). */
export function parseCompactClaim(value: string): { kind: ClaimKind; cites: RawCite[] } | string {
  const text = value.trim();
  const sp = text.search(/\s/);
  const kind = sp < 0 ? text : text.slice(0, sp);
  if (!CLAIM_KINDS.has(kind)) return `claim kind one of ${[...CLAIM_KINDS].join(", ")}`;
  const rest = sp < 0 ? "" : text.slice(sp).trim();
  if (rest === "") return { kind: kind as ClaimKind, cites: [] };
  const cites: RawCite[] = [];
  let dir = "";
  for (const part of rest.split(",")) {
    const seg = part.trim();
    const prev = cites[cites.length - 1];
    const bare = prev ? BARE_RANGE_RE.exec(seg) : null;
    if (prev && bare) {
      const start = Number(bare[1]);
      cites.push({ path: prev.path, start, end: bare[2] === undefined ? start : Number(bare[2]) });
      continue;
    }
    const m = CITE_RE.exec(seg);
    if (!m) return `cite "<path>:<a>-<b>", got "${seg.slice(0, 60)}"`;
    let path = (m[1] as string).trim();
    if (path === "" || /\s/.test(path)) return `cite path without spaces, got "${path.slice(0, 60)}"`;
    if (!path.includes("/") && cites.length > 0) path = dir + path;
    const slash = path.lastIndexOf("/");
    dir = slash >= 0 ? path.slice(0, slash + 1) : "";
    const start = Number(m[2]);
    const end = m[3] === undefined ? start : Number(m[3]);
    cites.push({ path, start, end });
  }
  return { kind: kind as ClaimKind, cites };
}

/** Parse the `claims` field (compact map or full array) into drafts. */
export function parseClaims(raw: unknown, maxClaims: number, maxCites: number): ParsedClaims {
  const out: ParsedClaims = { claims: [], problems: [], unknownKeys: 0 };
  if (raw === undefined) return out;
  const problem = (at: string, expected: string, actual: unknown) => out.problems.push({ at, expected, actual: short(actual) });
  if (Array.isArray(raw)) {
    for (const [i, c] of raw.entries()) {
      const r = parseFullClaim(c, `/claims/${i}`, maxCites);
      if ("at" in r) out.problems.push(r);
      else {
        out.unknownKeys += r.unknown;
        out.claims.push(r.claim);
      }
    }
  } else if (isObject(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const at = `/claims/${key}`;
      if (!/^[1-9][0-9]?$/.test(key)) {
        problem(at, "claim key 1..99", key);
        continue;
      }
      if (typeof value !== "string") {
        problem(at, `"<kind> <path>:<a>-<b>,…"`, value);
        continue;
      }
      const parsed = parseCompactClaim(value);
      if (typeof parsed === "string") problem(at, parsed, value);
      else if (parsed.cites.length > maxCites) problem(at, `at most ${maxCites} cites`, parsed.cites.length);
      else out.claims.push({ n: Number(key), kind: parsed.kind, cites: parsed.cites });
    }
  } else problem("/claims", "compact claims object or claims array", raw);
  if (out.claims.length > maxClaims) problem("/claims", `at most ${maxClaims} claims`, out.claims.length);
  return out;
}

/** Parse one full-form claim object. */
function parseFullClaim(c: unknown, at: string, maxCites: number): { claim: GenClaimDraft; unknown: number } | ClaimProblem {
  const problem = (where: string, expected: string, actual: unknown): ClaimProblem => ({ at: where, expected, actual: short(actual) });
  if (!isObject(c)) return problem(at, "claim object {n, kind, cites}", c);
  let unknown = Object.keys(c).filter((k) => !["n", "kind", "cites"].includes(k)).length;
  const n = c.n;
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 99) return problem(`${at}/n`, "integer 1..99", n);
  if (typeof c.kind !== "string" || !CLAIM_KINDS.has(c.kind)) return problem(`${at}/kind`, "claim kind", c.kind);
  if (!Array.isArray(c.cites)) return problem(`${at}/cites`, "array of cites", c.cites);
  const cites: RawCite[] = [];
  for (const [j, x] of c.cites.entries()) {
    const cite = parseCiteObject(x);
    if (typeof cite === "string") return problem(`${at}/cites/${j}`, cite, x);
    unknown += cite.unknown;
    cites.push(cite.cite);
  }
  if (cites.length > maxCites) return problem(`${at}/cites`, `at most ${maxCites} cites`, cites.length);
  return { claim: { n: n as number, kind: c.kind as ClaimKind, cites }, unknown };
}

/** Parse one `{path, start, end}` cite object (question lines and full-form claims). */
export function parseCiteObject(x: unknown): { cite: RawCite; unknown: number } | string {
  if (!isObject(x)) return "cite object {path, start, end}";
  const { path, start, end } = x;
  if (typeof path !== "string" || path.length < 1 || path.length > 512) return "cite path string (1..512)";
  if (!Number.isInteger(start) || (start as number) < 0) return "cite start integer ≥ 0";
  if (!Number.isInteger(end) || (end as number) < 0) return "cite end integer ≥ 0";
  const unknown = Object.keys(x).filter((k) => !["path", "start", "end"].includes(k)).length;
  return { cite: { path, start: start as number, end: end as number }, unknown };
}

/** Plain-object guard. */
export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Short JSON excerpt for `CheckError.actual`. */
export function short(x: unknown, max = 120): string {
  let s: string;
  try {
    s = typeof x === "string" ? x : (JSON.stringify(x) ?? String(x));
  } catch {
    s = String(x);
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
