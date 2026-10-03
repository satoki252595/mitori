/**
 * Code-member re-anchoring cascade S0–S5 (loop spec §1.3 + 改訂 R1): one shared interner per batch, one line map
 * per (old blob, path), rarest-line pivot + prefix rolling hash for the S2 window search (≤ 64 candidates).
 * Never throws, never drops: anything unexpected becomes `outdated`.
 */
import type { AnchorHealth, Cite, CodeAnchor, GitOid, Hasher, IndexDelta, LineNo, ReanchorMethod, ReanchorResult, RepoPath, TextQuote } from "@mitori/core";
import {
  ANCHOR_LIMITS,
  type AnchorContext,
  type AnchoredItem,
  type LineHunk,
  type LineMap,
  type ReanchorItemResult,
  type ReanchorReport,
} from "../contract.ts";
import { buildLineMap, LineInterner } from "../linemap/linemap.ts";
import { normLine, snippetHash, splitLines } from "../normalize/index.ts";
import { codeQuoteAt, lineAt, lineOffsets } from "./capture.ts";
import { overlaps } from "./overlap.ts";
import { findQuote } from "./quote.ts";

/** Max S2 candidates before the window search gives up for S3/S4 (R1, PT-12). */
const MAX_CANDIDATES = 64;
const HASH_BASE = 0x9e3779b1;

type Code = CodeAnchor | Cite;

/** A current (new) file of the batch. */
class FileState {
  readonly lines: string[];
  readonly norm: string;
  readonly offsets: Int32Array;
  readonly ids: Int32Array;
  private positions: Map<number, number[]> | null = null;
  private prefix: Int32Array | null = null;
  private pow: Int32Array | null = null;

  constructor(
    readonly path: RepoPath,
    readonly blob: GitOid,
    text: string,
    interner: LineInterner,
  ) {
    this.lines = splitLines(text);
    this.norm = this.lines.join("\n");
    this.offsets = lineOffsets(this.lines);
    this.ids = interner.all(this.lines);
  }

  /** 0-based positions of a line id. */
  at(id: number): readonly number[] {
    if (!this.positions) {
      const pos = new Map<number, number[]>();
      for (let i = 0; i < this.ids.length; i++) {
        const id2 = this.ids[i] as number;
        const list = pos.get(id2);
        if (list) list.push(i);
        else pos.set(id2, [i]);
      }
      this.positions = pos;
    }
    return this.positions.get(id) ?? [];
  }

  /** Rolling hash of ids[s, s+n). */
  windowHash(s: number, n: number): number {
    if (!this.prefix || !this.pow) {
      const len = this.ids.length;
      const pre = new Int32Array(len + 1);
      const pow = new Int32Array(len + 1);
      pow[0] = 1;
      for (let i = 0; i < len; i++) {
        pre[i + 1] = (Math.imul(pre[i] as number, HASH_BASE) + (this.ids[i] as number) + 1) | 0;
        pow[i + 1] = Math.imul(pow[i] as number, HASH_BASE);
      }
      this.prefix = pre;
      this.pow = pow;
    }
    return ((this.prefix[s + n] as number) - Math.imul(this.prefix[s] as number, this.pow[n] as number)) | 0;
  }
}

function seqHash(ids: Int32Array): number {
  let h = 0;
  for (let i = 0; i < ids.length; i++) h = (Math.imul(h, HASH_BASE) + (ids[i] as number) + 1) | 0;
  return h;
}

/** An old blob of the batch. */
interface OldState {
  lines: string[];
  ids: Int32Array;
}

/** Everything one `reanchor` call shares across items. */
class Batch {
  readonly interner = new LineInterner();
  readonly files = new Map<RepoPath, FileState | null>();
  readonly olds = new Map<GitOid, OldState | null>();
  readonly maps = new Map<string, LineMap>();
  readonly mapped = new Set<RepoPath>();
  readonly renames = new Map<RepoPath, RepoPath>();
  added: RepoPath[] = [];

  constructor(
    readonly ctx: AnchorContext,
    readonly delta: IndexDelta,
    readonly hasher: Hasher,
  ) {
    for (const r of delta.renames) this.renames.set(r.from, r.to);
  }

  blobOf(path: RepoPath): GitOid | null {
    return safe(() => this.ctx.currentBlob(path), null);
  }

  targetOf(path: RepoPath): RepoPath {
    return safe(() => this.ctx.renamedTo(path), null) ?? this.renames.get(path) ?? path;
  }

  async load(items: readonly AnchoredItem[]): Promise<void> {
    const want = new Set<RepoPath>();
    const blobs = new Set<GitOid>();
    let anyGone = false;
    for (const it of items) {
      const a = codeOf(it);
      const t = this.targetOf(a.path);
      const cur = this.blobOf(t);
      if (cur === null) anyGone = true;
      else if (cur !== a.blob) {
        want.add(t);
        blobs.add(a.blob);
      }
    }
    if (this.delta.changed.length <= ANCHOR_LIMITS.crossFileMoveMaxChangedFiles) {
      const added = new Set<RepoPath>(safe(() => this.ctx.addedPaths(), []));
      for (const c of this.delta.changed) if (c.oldBlob === null && c.newBlob !== null) added.add(c.path);
      this.added = [...added].sort();
    }
    if (anyGone || this.added.length > 0) for (const p of this.added) want.add(p);
    await Promise.all([
      ...[...want].map(async (p) => {
        const blob = this.blobOf(p);
        const text = blob === null ? null : await this.ctx.currentText(p).catch(() => null);
        this.files.set(p, blob === null || text === null ? null : new FileState(p, blob, text, this.interner));
      }),
      ...[...blobs].map(async (b) => {
        const text = await this.ctx.blobText(b).catch(() => null);
        if (text === null) this.olds.set(b, null);
        else {
          const lines = splitLines(text);
          this.olds.set(b, { lines, ids: this.interner.all(lines) });
        }
      }),
    ]);
  }

  lineMap(oldBlob: GitOid, file: FileState): LineMap | null {
    const old = this.olds.get(oldBlob);
    if (!old) return null;
    const key = `${oldBlob}\u0000${file.path}`;
    let lm = this.maps.get(key);
    if (!lm) {
      lm = buildLineMap(old.lines, file.lines, this.interner, old.ids, file.ids);
      this.maps.set(key, lm);
      this.mapped.add(file.path);
    }
    return lm;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function codeOf(it: AnchoredItem): Code {
  return it.kind === "cite" ? it.cite : it.anchor;
}

/** What the S2 window search looks for. */
interface Needle {
  n: number;
  /** Line ids of the anchored range (null when only the quote's first line is known). */
  ids: Int32Array | null;
  /** Pivot id and its offset inside the range. */
  pivot: number;
  pivotAt: number;
  hash: number;
  snippet: string;
}

function needleOf(batch: Batch, a: Code, old: OldState | null): Needle | null {
  const n = a.end - a.start + 1;
  if (n <= 0) return null;
  let ids: Int32Array | null = null;
  if (old && a.end <= old.lines.length && snippetHash(batch.hasher, old.lines, a.start, a.end) === a.snippet) {
    ids = old.ids.subarray(a.start - 1, a.end);
  } else if ("quote" in a && a.quote) {
    const qLines = splitLines(a.quote.exact);
    if (qLines.length === n && batch.hasher.xxh3(qLines.map(normLine).join("\n")) === a.snippet) ids = batch.interner.all(qLines);
    else {
      const first = batch.interner.peekNormalized(normLine(qLines[0] ?? ""));
      return first < 0 ? null : { n, ids: null, pivot: first, pivotAt: 0, hash: 0, snippet: a.snippet };
    }
  }
  if (!ids) return null;
  return { n, ids, pivot: ids[0] as number, pivotAt: 0, hash: seqHash(ids), snippet: a.snippet };
}

function matchesAt(batch: Batch, f: FileState, nd: Needle, s: number): boolean {
  if (s < 0 || s + nd.n > f.ids.length) return false;
  if (nd.ids) {
    if (f.windowHash(s, nd.n) !== nd.hash) return false;
    for (let i = 0; i < nd.n; i++) if (f.ids[s + i] !== nd.ids[i]) return false;
    return true;
  }
  return snippetHash(batch.hasher, f.lines, s + 1, s + nd.n) === nd.snippet;
}

/** S2 window search: 1-based start nearest to `expected`, null when absent, "ambiguous" over 64 candidates. */
function findWindow(batch: Batch, f: FileState, nd: Needle, expected: LineNo): LineNo | null | "ambiguous" {
  if (matchesAt(batch, f, nd, expected - 1)) return expected;
  let pivot = nd.pivot;
  let pivotAt = nd.pivotAt;
  if (nd.ids) {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < nd.n; i++) {
      const c = f.at(nd.ids[i] as number).length;
      if (c < best) {
        best = c;
        pivot = nd.ids[i] as number;
        pivotAt = i;
        if (c === 0) return null;
      }
    }
  }
  const pos = f.at(pivot);
  if (pos.length > MAX_CANDIDATES) return "ambiguous";
  let found: LineNo | null = null;
  for (const p of pos) {
    const s = p - pivotAt;
    if (!matchesAt(batch, f, nd, s)) continue;
    const line = s + 1;
    if (found === null || Math.abs(line - expected) < Math.abs(found - expected)) found = line;
  }
  return found;
}

function result(health: AnchorHealth, method: ReanchorMethod, anchor: Code, previous: Code, confidence: number): ReanchorResult<CodeAnchor | Cite> {
  return { health, method, anchor, previous, confidence };
}

/** Re-stamp a moved/changed range at the current file. */
function restamp(batch: Batch, a: Code, f: FileState, start: LineNo, end: LineNo, quote?: TextQuote): Code {
  const s = Math.min(Math.max(start, 1), f.lines.length);
  const e = Math.min(Math.max(end, s), f.lines.length);
  const out: Code = { ...a, path: f.path, start: s, end: e, blob: f.blob, snippet: snippetHash(batch.hasher, f.lines, s, e) };
  const sym = safe(() => batch.ctx.enclosingSymbol(f.path, s, e), null);
  if (sym) out.symbol = sym;
  else delete out.symbol;
  if (quote && "quote" in a) (out as CodeAnchor).quote = quote;
  return out;
}

function outdated(a: Code): ReanchorItemResult {
  return { result: result("outdated", "none", a, a, 0), overlapped: true, step: "S5" };
}

/** S4 on one file. */
function quoteIn(batch: Batch, a: Code, f: FileState, hint: number, spanLines: number) {
  const q = "quote" in a ? a.quote : undefined;
  if (!q) return null;
  const m = findQuote(f.norm, q, hint);
  if (!m || m.score < ANCHOR_LIMITS.quoteAcceptSim) return null;
  const n = a.end - a.start + 1;
  const ns = lineAt(f.offsets, m.start);
  const coversRange = splitLines(q.exact).length === n;
  const ne = coversRange ? lineAt(f.offsets, Math.max(m.start, m.end - 1)) : ns + spanLines;
  const anchor = restamp(batch, a, f, ns, ne, codeQuoteAt(f.norm, m.start, m.end));
  return { anchor, score: m.score };
}

function one(batch: Batch, it: AnchoredItem): ReanchorItemResult {
  const a = codeOf(it);
  const spanLines = it.kind === "thread" && it.snapshot?.spanLines !== undefined ? it.snapshot.spanLines : a.end - a.start;
  const target = batch.targetOf(a.path);
  const n = a.end - a.start + 1;
  if (n <= 0) return outdated(a);

  // S1 identity (a rename keeps the range; only path and symbol are re-stamped).
  const curBlob = batch.blobOf(target);
  if (curBlob !== null && curBlob === a.blob) {
    if (target === a.path) return { result: result("ok", "identity", a, a, 1), overlapped: false, step: "S1" };
    const anchor: Code = { ...a, path: target };
    const sym = safe(() => batch.ctx.enclosingSymbol(target, a.start, a.end), null);
    if (sym) anchor.symbol = sym;
    else delete anchor.symbol;
    return { result: result("moved", "identity", anchor, a, 1), overlapped: false, step: "S1" };
  }
  const cur = curBlob === null ? null : (batch.files.get(target) ?? null);
  const old = batch.olds.get(a.blob) ?? null;
  const needle = needleOf(batch, a, old);
  const others = batch.added.map((p) => batch.files.get(p) ?? null).filter((f): f is FileState => f !== null && f.path !== target);

  const crossFile = (): ReanchorItemResult | null => {
    if (!needle) return null;
    for (const f of others) {
      const s = findWindow(batch, f, needle, a.start);
      if (typeof s === "number") {
        return {
          result: result("moved", "symbol", restamp(batch, a, f, s, s + n - 1), a, ANCHOR_LIMITS.crossFileMoveConfidence),
          overlapped: true,
          step: "S2",
        };
      }
    }
    return null;
  };

  if (!cur) {
    // S0: deleted without rename ⇒ S2 / S4 over the added files, then S5.
    const moved = crossFile();
    if (moved) return moved;
    let best: { anchor: Code; score: number } | null = null;
    for (const f of others) {
      const q = quoteIn(batch, a, f, 0, spanLines);
      if (q && (!best || q.score > best.score)) best = q;
    }
    if (best) {
      const health = best.score >= ANCHOR_LIMITS.quoteMovedScore && best.anchor.snippet === a.snippet ? "moved" : "fuzzy";
      return { result: result(health, "quote", best.anchor, a, health === "fuzzy" ? Math.min(best.score, 0.94) : best.score), overlapped: true, step: "S4" };
    }
    return outdated(a);
  }

  const lm = batch.lineMap(a.blob, cur);
  const hunks: readonly LineHunk[] | null = lm ? lm.hunks : null;
  const overlapped = (healthOk: boolean) => (hunks ? overlaps(a.start, a.end, hunks) : !healthOk);

  // S2 snippet window (expected position: symbol → line map → same line).
  let expected: LineNo = a.start;
  const symStart = it.kind === "thread" ? it.snapshot?.symStart : undefined;
  const sym = a.symbol !== undefined && symStart !== undefined ? safe(() => batch.ctx.symbolRange(a.symbol as NonNullable<Code["symbol"]>), null) : null;
  if (sym && symStart !== undefined) expected = sym.start + (a.start - symStart);
  else if (lm) expected = lm.mapStart(a.start);
  if (needle) {
    const s = findWindow(batch, cur, needle, expected);
    if (typeof s === "number") {
      const same = target === a.path && s === a.start;
      return { result: result(same ? "ok" : "moved", "symbol", restamp(batch, a, cur, s, s + n - 1), a, 1), overlapped: overlapped(same), step: "S2" };
    }
  }

  // Survival in place (blank lines carry no identity: they count only when the range has nothing else).
  let mapped = 0;
  let allExact = true;
  let content = 0;
  let mappedContent = 0;
  if (lm && old) {
    const blank = batch.interner.peekNormalized("");
    for (let l = a.start; l <= a.end; l++) {
      const isBlank = old.ids[l - 1] === blank;
      if (!isBlank) content++;
      if (lm.map(l) !== null) {
        mapped++;
        if (!isBlank) mappedContent++;
        if (!lm.exact(l)) allExact = false;
      }
    }
  }
  const survival = content > 0 ? mappedContent / content : mapped / n;
  if (!lm || survival < ANCHOR_LIMITS.diffMinSurvival) {
    const moved = crossFile();
    if (moved) return moved;
  }

  // S3 Myers line map.
  if (lm && cur.lines.length > 0) {
    const ns = Math.min(Math.max(lm.mapStart(a.start), 1), cur.lines.length);
    const ne = Math.min(Math.max(lm.mapEnd(a.end, ns), ns), cur.lines.length);
    const span = ne - ns + 1;
    if (mapped === n && span === n) {
      const same = target === a.path && ns === a.start && allExact;
      return { result: result(same ? "ok" : "moved", "diff", restamp(batch, a, cur, ns, ne), a, 1), overlapped: overlapped(same), step: "S3" };
    }
    const r = (survival * n) / Math.max(n, span);
    if (r >= ANCHOR_LIMITS.diffMinSurvival) {
      return { result: result("fuzzy", "diff", restamp(batch, a, cur, ns, ne), a, r), overlapped: overlapped(false), step: "S3" };
    }
  }

  // S4 TextQuote near the mapped (or old) position.
  if (cur.lines.length > 0) {
    const hintLine = lm ? Math.min(Math.max(lm.mapStart(a.start), 1), cur.lines.length) : Math.min(a.start, cur.lines.length);
    const q = quoteIn(batch, a, cur, cur.offsets[hintLine - 1] as number, spanLines);
    if (q) {
      const same = target === a.path && q.anchor.start === a.start;
      if (q.score >= ANCHOR_LIMITS.quoteMovedScore && q.anchor.snippet === a.snippet) {
        return { result: result(same ? "ok" : "moved", "quote", q.anchor, a, q.score), overlapped: overlapped(same), step: "S4" };
      }
      // A changed (not identical) quote counts only where the old range now is; elsewhere it is a different text.
      const region = lm ? newRegion(lm, a.start, a.end) : null;
      if (!lm || (region !== null && q.anchor.start <= region[1] && q.anchor.end >= region[0])) {
        return { result: result("fuzzy", "quote", q.anchor, a, Math.min(q.score, 0.94)), overlapped: overlapped(false), step: "S4" };
      }
    }
  }
  return outdated(a);
}

/** New lines the old range turned into: targets of its surviving lines plus the replacement side of hunks inside it. */
function newRegion(lm: LineMap, start: LineNo, end: LineNo): [LineNo, LineNo] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let l = start; l <= end; l++) {
    const t = lm.map(l);
    if (t !== null) {
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  for (const h of lm.hunks) {
    if (h.newLines > 0 && overlaps(start, end, [h])) {
      lo = Math.min(lo, h.newStart);
      hi = Math.max(hi, h.newStart + h.newLines - 1);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Batch re-anchoring (S0–S5). Same order and length as `items`. */
export async function reanchorItems(hasher: Hasher, items: AnchoredItem[], delta: IndexDelta, ctx: AnchorContext, now: () => number): Promise<ReanchorReport> {
  const t0 = now();
  const batch = new Batch(ctx, delta, hasher);
  try {
    await batch.load(items);
  } catch {
    /* every unavailable text is treated as missing below */
  }
  const results = items.map((it) => {
    try {
      return one(batch, it);
    } catch {
      return outdated(codeOf(it));
    }
  });
  const counts: Record<AnchorHealth, number> = { ok: 0, moved: 0, fuzzy: 0, outdated: 0 };
  for (const r of results) counts[r.result.health]++;
  return { results, counts, mapped: [...batch.mapped].sort(), ms: now() - t0 };
}
