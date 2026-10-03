import {
  type BlockId,
  type Cite,
  type ClaimId,
  type ExcludeReason,
  type ExecMode,
  type FileEntry,
  type Glob,
  type LineNo,
  parseRepoPath,
  type RepoPath,
  type Result,
  type SectionId,
  type ThreadDetail,
} from "@mitori/core";
import { RELATED_TEST_PATTERNS, ROUTER_LIMITS } from "../contract.ts";
import { pathMatcher } from "./deny.ts";
import { anchorRanges, type CodeRange, lineCount, mergeRanges } from "./ranges.ts";
import { fail } from "./result.ts";

/** Everything `deriveWriteScope` may ask the host (the contract's ctx). */
export interface ScopeCtx {
  mode: ExecMode;
  extra: { path: RepoPath; start: LineNo; end: LineNo }[];
  deny: Glob[];
  citesOfBlock(block: BlockId): Cite[];
  citesOfClaim(claim: ClaimId): Cite[];
  moduleFilesOfSection(section: SectionId): RepoPath[];
  fileExists(path: RepoPath): boolean;
  fileEntry(path: RepoPath): FileEntry | null;
  /**
   * Section of a doc block, for the doc_edit module fallback (spec §3.3). CR-PENDING(WP-08a): the contract's ctx has
   * no way to learn the section of an anchored block (docs/design/cr-requests/WP-08a.md); optional so the contract's
   * own ctx shape still type-checks. Without it the fallback yields nothing.
   */
  sectionOfBlock?(block: BlockId): SectionId | null;
}

export interface ScopeResult {
  writeScope: RepoPath[];
  newFiles: RepoPath[];
  anchoredLines: number;
  ranges: { path: RepoPath; start: LineNo; end: LineNo }[];
}

/** Excluded classes an agent can never usefully or safely write (spec §3.3: symlink / submodule / binary, SEC-18 attribute-bearing paths surface as `special`). */
const UNWRITABLE: ReadonlySet<ExcludeReason> = new Set(["binary", "secret", "deny_glob", "special", "oversize", "minified", "data_large", "gitignored"]);
/** Excluded classes whose text must not be put in a bundle at all. */
const UNREADABLE: ReadonlySet<ExcludeReason> = new Set(["binary", "secret", "deny_glob", "special", "oversize"]);

/** A file whose text may go into a bundle: it exists in the index and is not binary / secret / special / oversize. */
export function readableFile(entry: FileEntry | null): boolean {
  return entry !== null && !(entry.excluded !== undefined && UNREADABLE.has(entry.excluded));
}

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Write-scope derivation (spec §3.3). Deterministic, never decided by a model. Anchor ranges follow §3.2; the scope
 * follows the intent table; chips add paths and context ranges; deny globs and unwritable files are removed; agent
 * mode adds the related tests that already exist; `answer` mode never writes (empty scope, ranges still returned).
 */
export function deriveScope(threads: ThreadDetail[], ctx: ScopeCtx): Result<ScopeResult> {
  const denied = pathMatcher(ctx.deny);
  let sawDenied = false;
  let candidates = 0;

  const readable = (path: RepoPath): boolean => {
    candidates++;
    if (!parseRepoPath(path).ok) return false;
    if (denied(path)) {
      sawDenied = true;
      return false;
    }
    return readableFile(ctx.fileEntry(path)) && ctx.fileExists(path);
  };
  const writable = (path: RepoPath): boolean => {
    const entry = ctx.fileEntry(path);
    return entry !== null && !(entry.excluded !== undefined && UNWRITABLE.has(entry.excluded));
  };

  // §3.2: code ranges of every thread, plus context ranges from chips.
  const raw: CodeRange[] = [];
  const scopePaths = new Set<RepoPath>();
  const newFiles = new Set<RepoPath>();
  let scopeWanted = false;

  for (const t of threads) {
    const ranges = anchorRanges(t.anchor, ctx).filter((r) => readable(r.path));
    raw.push(...ranges);
    switch (t.intent) {
      case "change":
      case "note":
        scopeWanted = true;
        for (const r of ranges) scopePaths.add(r.path);
        break;
      case "doc_edit": {
        scopeWanted = true;
        const cited = t.anchor.doc ? ctx.citesOfBlock(t.anchor.doc.block).map((c) => c.path) : [];
        const paths = cited.filter((p) => readable(p));
        if (paths.length > 0) for (const p of paths) scopePaths.add(p);
        else if (t.anchor.doc) for (const p of moduleFallback(t.anchor.doc.block, ctx, readable)) scopePaths.add(p);
        break;
      }
      case "question":
      case "review":
        break;
    }
  }

  for (const x of ctx.extra) {
    const p = parseRepoPath(x.path);
    if (!p.ok) return fail("E_INVALID_INPUT", `invalid chip path: ${x.path}`, { params: { path: x.path } });
    if (x.start === 0 && x.end === 0) {
      // A declared new file (or an existing file added whole to the scope).
      if (denied(p.value)) {
        sawDenied = true;
        candidates++;
        continue;
      }
      if (scopeWanted) {
        scopePaths.add(p.value);
        if (!ctx.fileExists(p.value)) newFiles.add(p.value);
      }
      continue;
    }
    if (!Number.isInteger(x.start) || !Number.isInteger(x.end) || x.start < 1 || x.end < x.start) {
      return fail("E_INVALID_INPUT", `invalid chip range: ${x.path}:${x.start}-${x.end}`, { params: { path: x.path } });
    }
    if (readable(p.value)) {
      raw.push({ path: p.value, start: x.start, end: x.end });
      if (scopeWanted) scopePaths.add(p.value);
    }
  }

  const ranges = mergeRanges(raw);
  const anchoredLines = lineCount(ranges);

  if (candidates > 0 && ranges.length === 0 && scopePaths.size === 0 && newFiles.size === 0 && sawDenied) {
    return fail("E_DENY_GLOB", "every anchored file matches a deny glob", { actions: ["copy_prompt"] });
  }

  // Unwritable files can be read as context but never join the scope; paths that do not exist are only allowed as declared new files.
  const scope = new Set<RepoPath>();
  for (const p of scopePaths) {
    if (newFiles.has(p)) scope.add(p);
    else if (ctx.fileExists(p) && writable(p)) scope.add(p);
  }

  if (ctx.mode === "answer") return { ok: true, value: { writeScope: [], newFiles: [], anchoredLines, ranges } };

  if (scope.size > ROUTER_LIMITS.writeScopeMax) {
    return fail("E_PRECONDITION", `the write scope has ${scope.size} files (at most ${ROUTER_LIMITS.writeScopeMax})`, {
      actions: ["narrow_scope"],
      params: { files: scope.size, max: ROUTER_LIMITS.writeScopeMax },
    });
  }

  if (ctx.mode === "agent") {
    for (const test of relatedTests([...scope].sort(byPath), ctx)) {
      if (scope.size >= ROUTER_LIMITS.writeScopeMax) break;
      if (!denied(test) && writable(test)) scope.add(test);
    }
  }

  return { ok: true, value: { writeScope: [...scope].sort(byPath), newFiles: [...newFiles].filter((p) => scope.has(p)).sort(byPath), anchoredLines, ranges } };
}

/** doc_edit without cites: a `s6/<slug>` section's member files, largest LOC first, at most 8 (spec §3.3). */
function moduleFallback(block: BlockId, ctx: ScopeCtx, readable: (p: RepoPath) => boolean): RepoPath[] {
  const section = ctx.sectionOfBlock?.(block) ?? null;
  if (!section?.startsWith("s6/")) return [];
  return ctx
    .moduleFilesOfSection(section)
    .filter((p) => readable(p))
    .map((p) => ({ p, loc: ctx.fileEntry(p)?.loc ?? 0 }))
    .sort((a, b) => b.loc - a.loc || byPath(a.p, b.p))
    .slice(0, ROUTER_LIMITS.docEditModuleFilesMax)
    .map((x) => x.p);
}

/** Conventional test files of each path that already exist (spec §3.3, `RELATED_TEST_PATTERNS`). */
function relatedTests(paths: readonly RepoPath[], ctx: ScopeCtx): RepoPath[] {
  const out = new Set<RepoPath>();
  for (const path of paths) {
    const entry = ctx.fileEntry(path);
    if (!entry || entry.class === "test") continue;
    const patterns = (RELATED_TEST_PATTERNS as Record<string, readonly string[]>)[entry.lang] ?? [];
    const slash = path.lastIndexOf("/");
    const dir = slash < 0 ? "" : path.slice(0, slash);
    const file = path.slice(slash + 1);
    const dot = file.lastIndexOf(".");
    const stem = dot <= 0 ? file : file.slice(0, dot);
    const ext = dot <= 0 ? "" : file.slice(dot + 1);
    for (const pattern of patterns) {
      let candidate = pattern.replaceAll("{stem}", stem).replaceAll("{ext}", ext);
      candidate = dir === "" ? candidate.replace(/^\{dir\}\//u, "") : candidate.replaceAll("{dir}", dir);
      if (candidate !== path && ctx.fileExists(candidate)) out.add(candidate);
    }
  }
  return [...out].sort(byPath);
}
