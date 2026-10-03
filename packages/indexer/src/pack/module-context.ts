/**
 * Module inputs for gen S5 (spec §7.2–7.3, §7.8 I5; CR m1-27): module / repo skeletons assembled from the facade's
 * per-file fragments with the §7.2 degradation, hot bodies (§7.3), rationale comments (I5) and `moduleContext`.
 * Pure over the S3 result and a synchronous text cache the later stages warm before a scan / update resolves, so the
 * same index always yields the same bytes (cache keys stay valid).
 */
import type { CodeSlice, Fact, ModuleId, ModuleInfo, RepoPath, SecretScanner, SymbolKey, Xxh3 } from "@mitori/core";
import { HOT_BODY_RULES, type ModuleContext, type ModuleDetail, SKELETON_RULES, type Skeleton, type SkeletonTier } from "../contract.ts";
import type { FactsResult } from "../facts/stage.ts";
import type { StageFile } from "../resolve/files.ts";
import type { StructureResult } from "../structure/stage.ts";
import { moduleFactLines } from "./repo-pack.ts";
import { visibleControls } from "./visible.ts";

/** What the assembly reads (tokenizer already bound by the caller). */
export interface PackIo {
  /** The facade's file fragment (header included, secret-scanned), or null. */
  fileSkeleton(path: RepoPath, tier: SkeletonTier): Skeleton | null;
  /** Current text from the warmed cache (null when not cached). */
  text(path: RepoPath): string | null;
  /** `estimateTokens(text, "code", tokenizer)`. */
  estimate(text: string): number;
  xxh3(s: string): Xxh3;
  secrets?: SecretScanner;
}

/** The S2–S4 state the assembly works on. */
export interface PackState {
  structure: StructureResult;
  facts: FactsResult;
  files: ReadonlyMap<RepoPath, StageFile>;
  details: ReadonlyMap<ModuleId, ModuleDetail>;
}

type Sym = StageFile["symbols"][number];

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const H = HOT_BODY_RULES;
const CALLABLE = new Set(["function", "method", "constructor"]);
/** Max share of the module input the skeleton may take before degradation (the rest is hot bodies). */
const SKELETON_SHARE = 1 - H.maxShare;
/** Token caps of the small parts (spec §7.2). */
const TESTS_MAX = 1_500;
const FACTS_MAX = 1_000;
const NEIGHBORS_MAX = 10;
/** Rationale slices: ±2 lines around the comment. */
const RATIONALE_PAD = 2;

/** Member paths of a module (a parent aggregates its leaves). */
export function memberPaths(s: PackState, id: ModuleId): RepoPath[] {
  const out: RepoPath[] = [];
  const stack = [id];
  for (let guard = 0; stack.length > 0 && guard < 100_000; guard++) {
    const m = s.details.get(stack.pop() as ModuleId);
    if (!m) continue;
    if (m.paths.length > 0) out.push(...m.paths);
    else stack.push(...m.children);
  }
  return [...new Set(out)];
}

const rankOf = (s: PackState) => (p: RepoPath) => s.structure.fileRank.get(p) ?? 0;

/** Paths by file rank desc, then path. */
function ranked(s: PackState, paths: readonly RepoPath[]): RepoPath[] {
  const r = rankOf(s);
  return [...paths].sort((a, b) => r(b) - r(a) || byStr(a, b));
}

/* ------------------------------------------------------------------ skeletons */

interface Part {
  path: RepoPath;
  lines: string[];
  key: string;
  redactions: number;
  folded: boolean;
}

/** Line numbers of field declarations to drop at degradation step 1 (private fields) or 2 (fields of private types). */
function fieldLines(f: StageFile | undefined, step: 1 | 2): Set<number> {
  const out = new Set<number>();
  if (!f) return out;
  const byKey = new Map<SymbolKey, Sym>(f.symbols.map((x) => [x.key, x]));
  for (const x of f.symbols) {
    if (x.kind !== "field") continue;
    const parent = x.parent === undefined ? undefined : byKey.get(x.parent);
    const drop = step === 1 ? !x.exported : parent !== undefined && !parent.exported;
    if (drop) for (let n = x.start; n <= x.end; n++) out.add(n);
  }
  return out;
}

const lineNo = (l: string): number | null => {
  const m = /^(\d+)\|/.exec(l);
  return m ? Number(m[1]) : null;
};

const partText = (p: Part) => `${p.lines.join("\n")}\n`;

/**
 * Concatenated file fragments by file rank (spec §7.2). When `budget` is given and exceeded: (1) drop the field lines
 * of non-exported members, (2) drop the field lines of non-exported types, (3) fold the lowest-ranked files to
 * `=== <path> (<n> declarations not shown)` (gen request I2) — each step only while the result is still too large.
 */
export function assembleSkeleton(
  s: PackState,
  paths: readonly RepoPath[],
  tier: SkeletonTier,
  budget: number | undefined,
  io: PackIo,
  keyPart: string,
): Skeleton {
  const parts: Part[] = [];
  for (const p of ranked(s, paths)) {
    const sk = io.fileSkeleton(p, tier);
    if (sk === null) continue;
    const lines = sk.text.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    parts.push({ path: p, lines, key: sk.key, redactions: sk.redactions, folded: false });
  }
  const tokens = parts.map((p) => io.estimate(partText(p)));
  const total = () => tokens.reduce((a, b) => a + b, 0);
  let level = 0;
  if (budget !== undefined && tier !== "l0")
    for (const step of [1, 2] as const) {
      if (total() <= budget) break;
      level = step;
      parts.forEach((p, i) => {
        const drop = fieldLines(s.files.get(p.path), step);
        if (drop.size === 0) return;
        p.lines = p.lines.filter((l) => {
          const n = lineNo(l);
          return n === null || !drop.has(n);
        });
        tokens[i] = io.estimate(partText(p));
      });
    }
  for (let i = parts.length - 1; budget !== undefined && total() > budget && i > 0; i--) {
    const p = parts[i] as Part;
    const decls = (s.files.get(p.path)?.symbols ?? []).filter((x) => x.kind !== "field" && x.parent === undefined).length;
    p.lines = [`=== ${p.path} (${decls} declarations not shown)`];
    p.folded = true;
    tokens[i] = io.estimate(partText(p));
    level = 3;
  }
  const text = visibleControls(parts.map(partText).join(""));
  return {
    tier,
    text,
    tokens: io.estimate(text),
    files: parts.map((p) => p.path),
    omitted: parts.filter((p) => p.folded).map((p) => p.path),
    perFile: parts.map((p, i) => ({ path: p.path, tokens: tokens[i] as number, folded: p.folded })),
    redactions: parts.reduce((n, p) => n + p.redactions, 0),
    key: io.xxh3(`${keyPart}\0${tier}\0${budget ?? ""}\0${level}\0${parts.map((p) => p.key).join(",")}`),
  };
}

/** `skeleton({kind: "module"})`: the module's members (a parent's leaves). */
export function moduleSkeleton(s: PackState, id: ModuleId, tier: SkeletonTier, budget: number | undefined, io: PackIo): Skeleton {
  if (!s.details.has(id)) throw new Error(`no module ${id}`);
  return assembleSkeleton(s, memberPaths(s, id), tier, budget, io, `module\0${id}`);
}

/** `skeleton({kind: "repo"})`: every included source file (l0 by default), folded from the bottom when over budget. */
export function repoSkeleton(s: PackState, tier: SkeletonTier, budget: number | undefined, io: PackIo): Skeleton {
  const paths = [...s.files.values()].filter((f) => f.excluded === undefined && f.class === "source").map((f) => f.path);
  return assembleSkeleton(s, paths, tier, budget, io, "repo");
}

/* ------------------------------------------------------------------ hot bodies */

/** A hot-body candidate with its §7.3 score. */
export interface HotCandidate {
  sym: Sym;
  score: number;
}

const hotMemo = new WeakMap<StructureResult, Map<ModuleId, HotCandidate[]>>();

/** Files that call `name` (refs `call` / `new` / `jsx`) per name, over the whole snapshot (memoized per structure). */
const callersMemo = new WeakMap<StructureResult, Map<string, Set<RepoPath>>>();
function callersOf(s: PackState): Map<string, Set<RepoPath>> {
  let m = callersMemo.get(s.structure);
  if (m) return m;
  m = new Map();
  for (const f of s.files.values()) {
    if (f.excluded !== undefined) continue;
    for (const r of f.refs) {
      if (r.kind !== "call" && r.kind !== "new" && r.kind !== "jsx" && r.kind !== "qual") continue;
      let set = m.get(r.name);
      if (!set) {
        set = new Set();
        m.set(r.name, set);
      }
      set.add(f.path);
    }
  }
  callersMemo.set(s.structure, m);
  return m;
}

const entryMemo = new WeakMap<StructureResult, Set<SymbolKey>>();

/** Entry symbols of the snapshot: route / CLI handlers, `main`, the symbols tests call in their subjects (memoized). */
function entrySymbols(s: PackState): Set<SymbolKey> {
  const hit = entryMemo.get(s.structure);
  if (hit) return hit;
  const out = new Set<SymbolKey>();
  entryMemo.set(s.structure, out);
  const around = (path: RepoPath, line: number) =>
    (s.files.get(path)?.symbols ?? [])
      .filter((x) => CALLABLE.has(x.kind) && x.start <= line && line <= x.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  s.facts.facts.forEach((f, i) => {
    if (f.scope === "example" || s.facts.scopes[i] === "test") return;
    if (f.kind === "route" && f.handler) out.add(f.handler);
    else if (f.kind === "cli") {
      const x = around(f.path, f.line);
      if (x) out.add(x.key);
    } else if (f.kind === "entry") {
      const file = f.entry === "main" && s.files.has(f.label) ? f.label : f.path;
      for (const x of s.files.get(file)?.symbols ?? []) if (x.name === "main" && CALLABLE.has(x.kind)) out.add(x.key);
    }
  });
  for (const t of s.facts.tests) {
    const called = new Set((s.files.get(t.test)?.refs ?? []).filter((r) => r.kind !== "type").map((r) => r.name));
    for (const subject of t.subjects) for (const x of s.files.get(subject)?.symbols ?? []) if (CALLABLE.has(x.kind) && called.has(x.name)) out.add(x.key);
  }
  return out;
}

/** Hot-body candidates of a module, best first (spec §7.3; budget independent, memoized per structure). */
export function hotCandidates(s: PackState, id: ModuleId): HotCandidate[] {
  let memo = hotMemo.get(s.structure);
  if (!memo) {
    memo = new Map();
    hotMemo.set(s.structure, memo);
  }
  const hit = memo.get(id);
  if (hit) return hit;
  const paths = memberPaths(s, id);
  const syms: Sym[] = [];
  for (const p of paths)
    for (const x of s.files.get(p)?.symbols ?? [])
      if (CALLABLE.has(x.kind) && x.end - x.start + 1 >= 2 && (x.bodyEnd ?? x.end) > (x.bodyStart ?? x.start)) syms.push(x);
  if (syms.length === 0) {
    memo.set(id, []);
    return [];
  }
  const rank = rankOf(s);
  const maxRank = Math.max(1e-12, ...paths.map(rank));
  // reach: entry symbols (1.0), symbols they call within two hops (0.6)
  const entries = entrySymbols(s);
  const byName = new Map<string, Sym[]>();
  for (const x of syms) byName.set(x.name, [...(byName.get(x.name) ?? []), x]);
  const near = new Set<SymbolKey>();
  let frontier = syms.filter((x) => entries.has(x.key));
  const callsOf = (x: Sym) => (s.files.get(x.path)?.refs ?? []).filter((r) => r.kind === "call" || r.kind === "new" || r.kind === "jsx").map((r) => r.name);
  for (let hop = 0; hop < 2; hop++) {
    const next: Sym[] = [];
    for (const x of frontier)
      for (const n of callsOf(x))
        for (const y of byName.get(n) ?? []) {
          if (entries.has(y.key) || near.has(y.key)) continue;
          near.add(y.key);
          next.push(y);
        }
    frontier = next;
  }
  const callers = callersOf(s);
  const fan = syms.map((x) => {
    let c = 0;
    for (const p of callers.get(x.name) ?? []) if (p !== x.path) c++;
    return c;
  });
  const maxFan = Math.max(0, ...fan);
  const maxCx = Math.max(0, ...syms.map((x) => x.complexity));
  const W = H.weights;
  const out = syms.map((x, i) => {
    const pr = (rank(x.path) / maxRank) * (x.exported ? 1 : H.privatePrFactor);
    const reach = entries.has(x.key) ? H.reachDirect : near.has(x.key) ? H.reachNear : 0;
    const fanin = maxFan > 0 ? Math.log1p(fan[i] as number) / Math.log1p(maxFan) : 0;
    const cx = maxCx > 0 ? Math.log1p(x.complexity) / Math.log1p(maxCx) : 0;
    return { sym: x, score: W.pr * pr + W.reach * reach + W.fanin * fanin + W.cx * cx };
  });
  out.sort((a, b) => b.score - a.score || byStr(a.sym.key, b.sym.key));
  memo.set(id, out);
  return out;
}

/** Numbered `start..end` of `lines`; a body over 200 lines keeps its first 80 lines + `⋮` (spec §7.3). */
function renderSlice(lines: readonly string[], start: number, end: number): string {
  const out: string[] = [];
  const long = end - start + 1 > H.longBodyLines;
  const last = long ? start + H.longBodyHead - 1 : end;
  for (let n = start; n <= last; n++) out.push(`${n}|${lines[n - 1] ?? ""}`);
  if (long) out.push(SKELETON_RULES.elision);
  return out.join("\n");
}

/** Pack ranges into budget-bounded, merged, secret-scanned numbered slices (the shared §7.3 slice rules). */
export function packSlices(
  ranges: readonly { path: RepoPath; blob: string; start: number; end: number }[],
  budget: number,
  io: Pick<PackIo, "text" | "estimate" | "secrets">,
  stopAfterSkips = true,
): CodeSlice[] {
  const lineCache = new Map<RepoPath, string[] | null>();
  const linesOf = (p: RepoPath) => {
    if (!lineCache.has(p)) lineCache.set(p, io.text(p)?.split("\n") ?? null);
    return lineCache.get(p) ?? null;
  };
  const picked: { path: RepoPath; blob: string; start: number; end: number }[] = [];
  let used = 0;
  let skips = 0;
  for (const r of ranges) {
    if (stopAfterSkips && skips >= H.maxConsecutiveSkips) break;
    const lines = linesOf(r.path);
    if (!lines) continue;
    const end = Math.min(r.end, lines.length);
    const start = Math.max(1, r.start);
    if (end < start) continue;
    const t = io.estimate(renderSlice(lines, start, end));
    if (used + t > budget) {
      skips++;
      continue;
    }
    skips = 0;
    used += t;
    picked.push({ path: r.path, blob: r.blob, start, end });
  }
  // merge adjacent / overlapping ranges per file, keeping the order of first appearance
  const merged: typeof picked = [];
  for (const r of picked) {
    const m = merged.find((x) => x.path === r.path && r.start <= x.end + 1 && x.start <= r.end + 1);
    if (m) {
      m.start = Math.min(m.start, r.start);
      m.end = Math.max(m.end, r.end);
    } else merged.push({ ...r });
  }
  return merged.map((r) => {
    let text = renderSlice(linesOf(r.path) ?? [], r.start, r.end);
    let redactions = 0;
    if (io.secrets) {
      const red = io.secrets.redact(text);
      text = red.text;
      redactions = red.redactions;
    }
    text = visibleControls(text);
    return { path: r.path, blob: r.blob, start: r.start, end: r.end, text, numbered: true, tokens: io.estimate(text), redactions };
  });
}

/** `hotBodies(module, budget)` (spec §7.3): candidates by score, whole bodies while they fit. */
export function hotBodies(s: PackState, id: ModuleId, budget: number, io: PackIo): CodeSlice[] {
  if (budget <= 0) return [];
  return packSlices(
    hotCandidates(s, id).map((c) => ({ path: c.sym.path, blob: c.sym.blob, start: c.sym.start, end: c.sym.end })),
    budget,
    io,
  );
}

/** Files whose texts `hotBodies` needs for budgets up to `tokens` per module (the cache the later stages warm). */
export function hotFiles(s: PackState, tokens: number): Set<RepoPath> {
  const out = new Set<RepoPath>();
  for (const m of s.structure.modules) {
    if (m.paths.length === 0) continue;
    let est = 0;
    for (const c of hotCandidates(s, m.id)) {
      if (est > tokens) break;
      // ≈ 40 chars per line at ≈ 2.3 chars per token (claude-v5 code): an upper estimate is fine, the cache is a superset
      est += (Math.min(c.sym.end - c.sym.start + 1, H.longBodyLines) * 40) / 2.3;
      out.add(c.sym.path);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ rationale comments */

/** `rationaleComments(limit)` (gen I5): ±2 lines around each comment, files by rank desc, lines asc. */
export function rationaleComments(s: PackState, ranges: (path: RepoPath) => readonly { start: number; end: number }[], limit: number, io: PackIo): CodeSlice[] {
  const paths = ranked(
    s,
    [...s.files.values()].filter((f) => f.excluded === undefined && f.class === "source" && f.scope !== "test").map((f) => f.path),
  );
  const out: CodeSlice[] = [];
  for (const p of paths) {
    if (out.length >= limit) break;
    const rs = [...ranges(p)].sort((a, b) => a.start - b.start);
    if (rs.length === 0) continue;
    const blob = s.files.get(p)?.blob ?? "";
    const slices = packSlices(
      rs.map((r) => ({ path: p, blob, start: r.start - RATIONALE_PAD, end: r.end + RATIONALE_PAD })),
      Number.POSITIVE_INFINITY,
      io,
      false,
    );
    for (const sl of slices.sort((a, b) => a.start - b.start)) if (out.length < limit) out.push(sl);
  }
  return out;
}

/** Files whose texts `rationaleComments(limit)` needs. */
export function rationaleFiles(s: PackState, ranges: (path: RepoPath) => readonly { start: number; end: number }[], limit: number): Set<RepoPath> {
  const out = new Set<RepoPath>();
  let n = 0;
  for (const p of ranked(
    s,
    [...s.files.values()].filter((f) => f.excluded === undefined && f.class === "source" && f.scope !== "test").map((f) => f.path),
  )) {
    if (n >= limit) break;
    const k = ranges(p).length;
    if (k === 0) continue;
    out.add(p);
    n += k;
  }
  return out;
}

/* ------------------------------------------------------------------ moduleContext */

/** Lines from the top while they fit `max` tokens. */
function capLines(lines: readonly string[], max: number, io: Pick<PackIo, "estimate">): string {
  const out: string[] = [];
  for (const l of lines) {
    const next = [...out, l].join("\n");
    if (io.estimate(next) > max) break;
    out.push(l);
  }
  return out.join("\n");
}

/** `T <path>: <name>; <name>; …` per attached test file (≤ 1.5k tokens). */
function testLines(s: PackState, m: ModuleDetail, io: PackIo): string {
  const tests = new Set(memberTests(s, m.id));
  const names = new Map<RepoPath, string[]>();
  for (const f of s.facts.facts) if (f.kind === "test" && tests.has(f.path)) names.set(f.path, [...(names.get(f.path) ?? []), f.name]);
  const lines = [...names].sort((a, b) => byStr(a[0], b[0])).map(([p, ns]) => `T ${p}: ${ns.join("; ")}`.replace(/[\r\n\t]+/g, " "));
  return visibleControls(capLines(lines, TESTS_MAX, io));
}

function memberTests(s: PackState, id: ModuleId): RepoPath[] {
  const out: RepoPath[] = [];
  const stack = [id];
  for (let guard = 0; stack.length > 0 && guard < 100_000; guard++) {
    const m = s.details.get(stack.pop() as ModuleId);
    if (!m) continue;
    out.push(...m.tests);
    stack.push(...m.children);
  }
  return [...new Set(out)];
}

/** `U <slug> <id>` (modules it uses) and `B <slug> <id>` (modules using it), by weight desc then slug, ≤ 10 each. */
function neighborLines(s: PackState, id: ModuleId): string {
  const leaves = new Set<ModuleId>();
  const stack = [id];
  for (let guard = 0; stack.length > 0 && guard < 100_000; guard++) {
    const m = s.details.get(stack.pop() as ModuleId);
    if (!m) continue;
    if (m.paths.length > 0) leaves.add(m.id);
    else stack.push(...m.children);
  }
  const uses = new Map<ModuleId, number>();
  const usedBy = new Map<ModuleId, number>();
  for (const e of s.structure.leafEdges) {
    if (leaves.has(e.from) && !leaves.has(e.to)) uses.set(e.to, (uses.get(e.to) ?? 0) + e.weight);
    if (leaves.has(e.to) && !leaves.has(e.from)) usedBy.set(e.from, (usedBy.get(e.from) ?? 0) + e.weight);
  }
  const lines = (tag: string, acc: Map<ModuleId, number>) =>
    [...acc]
      .map(([mid, w]) => ({ m: s.details.get(mid), w }))
      .filter((x): x is { m: ModuleDetail; w: number } => x.m !== undefined)
      .sort((a, b) => b.w - a.w || byStr(a.m.slug, b.m.slug))
      .slice(0, NEIGHBORS_MAX)
      .map((x) => `${tag} ${x.m.slug} ${x.m.id}`);
  return [...lines("U", uses), ...lines("B", usedBy)].join("\n");
}

/**
 * `moduleContext(module, {budget, tier, hotBudget})` (spec §7.2): skeleton degraded into 75 % of the budget minus the
 * small parts, then hot bodies within min(caller's hot budget, (skeleton + tests + facts) / 3, what is left) — hot
 * bodies stay ≤ 25 % of the module input.
 */
export function moduleContext(
  s: PackState,
  id: ModuleId,
  info: ModuleInfo,
  opts: { budget: number; tier?: SkeletonTier; hotBudget?: number },
  io: PackIo,
): ModuleContext {
  const m = s.details.get(id);
  if (!m) throw new Error(`no module ${id}`);
  const tier = opts.tier ?? "sig";
  const tok = (t: string) => (t === "" ? 0 : io.estimate(t));
  const members = new Set(memberPaths(s, id));
  const facts = visibleControls(
    capLines(
      moduleFactLines(
        s.facts.facts.filter((f: Fact, i) => members.has(f.path) && f.kind !== "test" && f.scope !== "example" && s.facts.scopes[i] !== "test"),
        s.facts,
        rankOf(s),
      ),
      FACTS_MAX,
      io,
    ),
  );
  const tests = testLines(s, m, io);
  const neighbors = neighborLines(s, id);
  const fixed = tok(tests) + tok(facts) + tok(neighbors);
  const skeleton = moduleSkeleton(s, id, tier, Math.max(0, Math.floor(opts.budget * SKELETON_SHARE) - fixed), io);
  const share = Math.floor((skeleton.tokens + tok(tests) + tok(facts)) / 3);
  const hotBudget = Math.max(0, Math.min(opts.hotBudget ?? share, share, opts.budget - fixed - skeleton.tokens));
  const hot = hotBodies(s, id, hotBudget, io);
  const hotTokens = hot.reduce((n, h) => n + h.tokens, 0);
  const tokens = { skeleton: skeleton.tokens, hot: hotTokens, tests: tok(tests), facts: tok(facts), neighbors: tok(neighbors), total: 0 };
  tokens.total = tokens.skeleton + tokens.hot + tokens.tests + tokens.facts + tokens.neighbors;
  return {
    module: info,
    skeleton,
    hot,
    tests,
    facts,
    neighbors,
    tokens,
    key: io.xxh3(
      `${skeleton.key}\0${id}\0${tier}\0${opts.budget}\0${hotBudget}\0${hot.map((h) => `${h.path}:${h.start}-${h.end}`).join(",")}\0${io.xxh3(tests + facts + neighbors)}`,
    ),
  };
}
