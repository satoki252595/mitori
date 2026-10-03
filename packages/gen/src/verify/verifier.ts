/**
 * Verifier (gen spec §6.5, §7.1): stamps blob / symbol / snippet on raw cites (never trusting LLM values),
 * applies W04 (clamp/swap) and W08 (relocation), and computes L0–L2. Blob texts come from the indexer
 * (pinned blobs stay readable); snippet hashes come from the anchor engine so claims and comments share one
 * normalization. Also serves as the doc store's `ClaimStamper` (current snapshot).
 */
import type { AnchorEngine } from "@mitori/anchor";
import type { Cite, Claim, ClaimChecks, ClaimId, Clock, GitOid, Hasher, LineNo, Metrics, RepoPath, SymbolEntry, SymbolKey, Xxh3 } from "@mitori/core";
import type { ClaimSpan, ClaimStamper, RawCite } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { GEN_LIMITS, type StampResult, type Verifier } from "../contract.ts";
import { extractIdentifiers } from "./index.ts";
import { l1, relocate, type Window } from "./l1.ts";

/** Ports of the Verifier. */
export interface VerifierDeps {
  /** Read-only index (blobs, files, symbols). */
  indexer: Pick<Indexer, "file" | "currentBlob" | "blobText" | "currentText" | "enclosingSymbol" | "symbolsAt">;
  /** Snippet hashing (`codeAnchor(...).snippet`). */
  anchors: Pick<AnchorEngine, "codeAnchor">;
  /** Hasher (deterministic L3 sampling). */
  hasher: Hasher;
  /** Clock (`checkedAt`). */
  clock: Clock;
  /** Metrics (`gen.cite.l1.vacuous`). */
  metrics?: Pick<Metrics, "inc">;
}

/** The gen Verifier plus the snapshot registry the orchestrator feeds (blobs the task input was built from). */
export interface GenVerifier extends Verifier, ClaimStamper {
  /**
   * Stamp at a task snapshot (Verifier) or, without one, at the current snapshot (ClaimStamper). `pack` = the run's
   * pinned repo-pack snapshot: a path the task input did not show is stamped at the blob the pack was built from (PT-05).
   */
  stamp(raw: readonly RawCite[], span: ClaimSpan, snapshot?: Xxh3, pack?: Xxh3): Promise<StampResult>;
  /** Record the blobs of `paths` as seen by the input built at `snapshot` (stamping uses them, PT-05). */
  remember(snapshot: Xxh3, blobs: ReadonlyMap<RepoPath, GitOid>): void;
  /** Drop a snapshot's blob map. */
  forget(snapshot: Xxh3): void;
}

/** Split text into lines like `@mitori/anchor` `splitLines` (CRLF / CR → LF, no trailing empty element). */
export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines;
}

interface Loaded {
  blob: GitOid;
  text: string;
  lines: string[];
  current: boolean;
}

/** Factory. */
export function createVerifier(deps: VerifierDeps): GenVerifier {
  const snapshots = new Map<Xxh3, Map<RepoPath, GitOid>>();
  const texts = new Map<GitOid, string>();

  async function load(path: RepoPath, snapshot: Xxh3 | null, pack: Xxh3 | null = null): Promise<Loaded | null> {
    const entry = deps.indexer.file(path);
    if (!entry || entry.excluded) return null;
    const current = deps.indexer.currentBlob(path) ?? entry.blob;
    const at = (s: Xxh3 | null) => (s !== null ? snapshots.get(s)?.get(path) : undefined);
    const blob = at(snapshot) ?? at(pack) ?? current;
    let text = texts.get(blob) ?? (await deps.indexer.blobText(blob));
    let used = blob;
    if (text === null && blob !== current) {
      // pinned blob no longer readable ⇒ fall back to the current text (cite is stamped against it)
      text = await deps.indexer.blobText(current);
      used = current;
    }
    if (text === null) text = await deps.indexer.currentText(path);
    if (text === null) return null;
    if (texts.size > 256) texts.clear();
    texts.set(used, text);
    return { blob: used, text, lines: splitLines(text), current: used === current };
  }

  /** The innermost symbol whose lines contain start..end (at the loaded blob). */
  async function enclosing(path: RepoPath, l: Loaded, start: LineNo, end: LineNo): Promise<SymbolEntry | undefined> {
    if (l.current) return deps.indexer.enclosingSymbol(path, start, end) ?? undefined;
    const symbols = await deps.indexer.symbolsAt(path, l.blob);
    let best: SymbolEntry | undefined;
    for (const s of symbols ?? []) if (s.start <= start && s.end >= end && (!best || s.end - s.start < best.end - best.start)) best = s;
    return best;
  }

  async function symbolOf(path: RepoPath, l: Loaded, start: LineNo, end: LineNo): Promise<SymbolKey | undefined> {
    return (await enclosing(path, l, start, end))?.key;
  }

  /**
   * L1 scope of a window: the qualified name of its enclosing symbol (`Server.handleLogin`) and the file's directory
   * name, which is the package qualifier in Go (`clicmd.Exit` citing internal/clicmd/clicmd.go) and the module name in
   * most layouts [real run 2026-10-04: 6 of 32 crit L1 failures were package-qualified Go names].
   */
  async function scopeOf(path: RepoPath, l: Loaded, start: LineNo, end: LineNo): Promise<string[]> {
    const s = await enclosing(path, l, start, end);
    const dirs = path.split("/").slice(0, -1);
    const dir = dirs[dirs.length - 1];
    return [...(s ? [s.qualname] : []), ...(dir ? [dir] : [])];
  }

  async function stamp(raw: readonly RawCite[], span: ClaimSpan, snapshot: Xxh3 | null, pack: Xxh3 | null): Promise<StampResult> {
    let l0Raw = true;
    let l0 = true;
    const repaired = new Set<"clamp" | "swap" | "relocate">();
    const windows: (Window & { path: RepoPath; loaded: Loaded })[] = [];
    const slack = GEN_LIMITS.citeClampSlack;
    for (const c of raw) {
      const loaded = await load(c.path, snapshot, pack);
      if (!loaded) {
        l0Raw = false;
        l0 = false;
        continue;
      }
      const n = loaded.lines.length;
      let { start, end } = c;
      const valid = (s: number, e: number) => s >= 1 && s <= e && e <= n && e - s < GEN_LIMITS.citeMaxSpan;
      if (!valid(start, end)) l0Raw = false;
      if (start === 0) {
        start = 1;
        repaired.add("clamp");
      }
      if (start > end && start - end <= slack) {
        [start, end] = [end, start];
        repaired.add("swap");
      }
      if (end > n && end - n <= slack) {
        end = n;
        repaired.add("clamp");
      }
      if (!valid(start, end)) {
        l0 = false;
        continue;
      }
      windows.push({ path: c.path, loaded, lines: loaded.lines, start, end, scope: await scopeOf(c.path, loaded, start, end) });
    }
    let result = raw.length === 0 || windows.length === 0 ? "vacuous" : l1(span.identifiers, windows);
    if (raw.length > 0 && windows.length > 0 && result === "vacuous") deps.metrics?.inc("gen.cite.l1.vacuous");
    let relocated = false;
    if (result === "fail" && raw.length === 1 && windows.length === 1) {
      const w = windows[0] as (typeof windows)[number];
      const d = relocate(span.identifiers, w);
      if (d !== null) {
        w.start += d;
        w.end += d;
        relocated = true;
        repaired.add("relocate");
        result = "pass";
      }
    }
    const cites: Cite[] = [];
    for (const w of windows) {
      const symbol = await symbolOf(w.path, w.loaded, w.start, w.end);
      const snippet = deps.anchors.codeAnchor(w.path, w.start, w.end, w.loaded.text, w.loaded.blob, symbol).snippet;
      const cite: Cite = { path: w.path, start: w.start, end: w.end, blob: w.loaded.blob, snippet, precision: relocated ? "search" : "exact" };
      if (symbol) cite.symbol = symbol;
      cites.push(cite);
    }
    const checks: ClaimChecks = { l0, l0Raw, l1: result, l2: true, checkedAt: deps.clock.iso() };
    if (repaired.size > 0) checks.repaired = [...repaired];
    return { cites, checks };
  }

  return {
    remember(snapshot, blobs) {
      const map = snapshots.get(snapshot) ?? new Map<RepoPath, GitOid>();
      for (const [p, b] of blobs) map.set(p, b);
      snapshots.set(snapshot, map);
    },
    forget(snapshot) {
      snapshots.delete(snapshot);
    },
    stamp(raw: readonly RawCite[], span: ClaimSpan, snapshot?: Xxh3, pack?: Xxh3): Promise<StampResult> {
      return stamp(raw, span, snapshot ?? null, pack ?? null);
    },
    async check(claims) {
      const out: ClaimChecks[] = [];
      for (const claim of claims) {
        const identifiers = extractIdentifiers(claim.markdown);
        let l0 = true;
        let l2 = true;
        const windows: Window[] = [];
        for (const c of claim.cites) {
          const loaded = await load(c.path, null);
          if (!loaded || !(c.start >= 1 && c.start <= c.end && c.end <= loaded.lines.length)) {
            l0 = false;
            l2 = false;
            continue;
          }
          windows.push({ path: c.path, lines: loaded.lines, start: c.start, end: c.end, scope: await scopeOf(c.path, loaded, c.start, c.end) });
          if (deps.anchors.codeAnchor(c.path, c.start, c.end, loaded.text, loaded.blob, c.symbol).snippet !== c.snippet) l2 = false;
        }
        const res = claim.cites.length === 0 || windows.length === 0 ? "vacuous" : l1(identifiers, windows);
        out.push({ l0, l0Raw: l0, l1: res, l2, checkedAt: deps.clock.iso() });
      }
      return out;
    },
    sampleForJudge(claims: readonly Claim[]): ClaimId[] {
      const out: ClaimId[] = [];
      for (const c of claims) {
        if (c.checks.l1 === "fail" || Number.parseInt(deps.hasher.xxh3(c.id).slice(-4), 16) % 10 === 0) out.push(c.id);
      }
      return out;
    },
  };
}
