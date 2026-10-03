// S0a (indexer spec §2.1–2.2): enumerate through GitReader, stat everything, apply the path rules, and decide per
// path whether the previous state can be reused (stat cache), whether the index blob is authoritative (clean) or the
// content must be hashed (dirty / untracked / racy). Reading content is the Worker's job.
import type { FsReader, FsStat, GitOid, GitReader, RepoPath } from "@mitori/core";
import { INVENTORY_LIMITS } from "../contract.ts";
import { dialectOf } from "../lang/detect.ts";
import type { FileRec } from "../update/model.ts";
import { type CompiledSettings, classifyPathWith, type LinguistAttrs } from "./classify.ts";

/** Hard caps of an enumeration (UXP-23: 200k entries or 2 s). */
export const ENUM_LIMITS = { maxEntries: 200_000, maxMs: 2_000 } as const;

/** Git-side state remembered between scans (drives the warm path). */
export interface GitState {
  head: GitOid | null;
  tree: GitOid | null;
  branch: string | null;
  indexMtime: bigint | null;
  headMtime: bigint | null;
  /** `(path, blob)` of tracked `.gitattributes` files ("" when none). */
  attrsKey: string;
  objectFormat: "sha1" | "sha256";
  gitDir: string;
}

export interface EnumerateInput {
  git: GitReader;
  fs: FsReader;
  root: string;
  settings: CompiledSettings;
  /** Changes when any classification input changes (globs). */
  settingsKey: string;
  prev: ReadonlyMap<RepoPath, FileRec> | null;
  prevSettingsKey: string | null;
  prevGit: GitState | null;
  /** Scan generation. */
  gen: number;
  /** Scan start, epoch ms (racy window). */
  startMs: number;
  /** Monotonic ms (time cap). */
  now: () => number;
  /** Ignore the stat cache. */
  force: boolean;
  /** Called with the raw listing before the stat pass (cold scans start the Worker pool from it). */
  onListed?: (paths: readonly string[]) => void;
}

export interface EnumerateResult {
  files: Map<RepoPath, FileRec>;
  /** Paths whose blob is unknown (must be hashed by the Worker if read). */
  unknownBlob: Set<RepoPath>;
  git: GitState;
  truncated: boolean;
  /** git status / check-attr were (re)run. */
  ranStatus: boolean;
  ranAttrs: boolean;
  /** Every previous record was kept as is and none disappeared (nothing to persist). */
  unchanged: boolean;
}

const ATTRS = ["linguist-vendored", "linguist-generated", "linguist-documentation"] as const;
const ASCII = /^[\x20-\x7e]*$/;

const nfc = (p: string): string => (ASCII.test(p) ? p : p.normalize("NFC"));

function attrValue(v: string | undefined): boolean | undefined {
  if (v === undefined || v === "unspecified") return undefined;
  if (v === "unset" || v === "false") return false;
  return true;
}

function sameAttrs(a: LinguistAttrs, b: LinguistAttrs): boolean {
  return a.vendored === b.vendored && a.generated === b.generated && a.documentation === b.documentation;
}

const join = (root: string, rel: string): string => (root.endsWith("/") ? `${root}${rel}` : `${root}/${rel}`);

/** stat of every previously known path (keyed by on-disk spelling). */
function statAll(fs: FsReader, root: string, prev: ReadonlyMap<RepoPath, FileRec>): Map<string, FsStat | null> {
  const out = new Map<string, FsStat | null>();
  for (const r of prev.values()) out.set(r.raw, fs.stat(join(root, r.raw)));
  return out;
}

export async function enumerate(inp: EnumerateInput): Promise<EnumerateResult> {
  const { git, fs, prev, prevGit } = inp;
  const listing = Promise.all([
    git.lsFiles(),
    git.head(),
    prevGit !== null ? Promise.resolve(prevGit.objectFormat) : git.objectFormat(),
    prevGit !== null ? Promise.resolve(prevGit.gitDir) : git.gitDir(),
  ]);
  // Warm scans: stat the known paths while the git subprocesses list (they run on other cores); only paths new to the
  // listing are stat'ed afterwards.
  const preStat = prev !== null ? statAll(fs, inp.root, prev) : null;
  const [ls, head, objectFormat, gitDir] = await listing;
  if (inp.onListed !== undefined) inp.onListed(ls.map((e) => e.path));
  const indexMtime = fs.stat(join(gitDir, "index"))?.mtimeNs ?? null;
  const headMtime = fs.stat(join(gitDir, "HEAD"))?.mtimeNs ?? null;

  // Dedupe (unmerged paths come back once per stage) and cap.
  const byRaw = new Map<string, { raw: string; blob: GitOid; mode: string; tracked: boolean; unmerged: boolean }>();
  let attrsKey = "";
  for (const e of ls) {
    const hit = byRaw.get(e.path);
    if (hit !== undefined) {
      if (e.stage !== 0) hit.unmerged = true;
      if (e.stage === 2) hit.blob = e.blob; // "ours"
      continue;
    }
    byRaw.set(e.path, { raw: e.path, blob: e.tracked ? e.blob : "", mode: e.mode, tracked: e.tracked, unmerged: e.stage !== 0 });
    if (e.tracked && (e.path === ".gitattributes" || e.path.endsWith("/.gitattributes"))) attrsKey += `${e.path}\0${e.blob}\n`;
  }
  let entries = [...byRaw.values()];
  let truncated = false;
  if (entries.length > ENUM_LIMITS.maxEntries) {
    entries.sort((a, b) => (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0));
    entries = entries.slice(0, ENUM_LIMITS.maxEntries);
    truncated = true;
  }

  const anyTracked = entries.some((e) => e.tracked);
  const ranStatus = anyTracked && (inp.force || prevGit === null || indexMtime === null || indexMtime !== prevGit.indexMtime);
  const headChanged = prevGit === null || head !== prevGit.head || headMtime !== prevGit.headMtime;
  const settingsChanged = inp.prevSettingsKey !== inp.settingsKey;
  const ranAttrs = attrsKey !== "" && (prevGit === null || attrsKey !== prevGit.attrsKey || inp.force);
  const attrPaths = attrsKey === "" ? [] : ranAttrs ? entries.map((e) => e.raw) : entries.filter((e) => !prev?.has(nfc(e.raw))).map((e) => e.raw);

  const [dirtyList, tree, branch, attrs] = await Promise.all([
    ranStatus ? git.statusDirty() : Promise.resolve(null),
    headChanged ? git.headTree() : Promise.resolve(prevGit.tree),
    headChanged ? git.branch() : Promise.resolve(prevGit.branch),
    attrPaths.length > 0 ? git.checkAttr(attrPaths, ATTRS) : Promise.resolve({} as Record<RepoPath, Record<string, string>>),
  ]);
  const dirtySet = dirtyList === null ? null : new Set(dirtyList);

  const files = new Map<RepoPath, FileRec>();
  const unknownBlob = new Set<RepoPath>();
  const racyFloorNs = BigInt(inp.startMs - INVENTORY_LIMITS.racyWindowMs) * 1_000_000n;
  const deadline = inp.now() + ENUM_LIMITS.maxMs;
  let unchanged = prev !== null && !settingsChanged;

  for (let i = 0; i < entries.length; i++) {
    if ((i & 255) === 0 && inp.now() > deadline) {
      truncated = true;
      break;
    }
    const e = entries[i] as (typeof entries)[number];
    const path = nfc(e.raw);
    const known = preStat?.get(e.raw);
    const st = known !== undefined ? known : fs.stat(join(inp.root, e.raw));
    const special = e.mode === "160000" || e.raw.endsWith("/");
    if (st === null && !special) continue; // deleted after ls-files
    const mode = e.tracked ? e.mode : st?.isSymlink ? "120000" : special ? "160000" : "100644";
    const size = st?.size ?? 0;
    const mtimeNs = ((st?.mtimeNs ?? 0n) / 1_000n) * 1_000n; // µs precision: what idx_files can store exactly
    const ino = st?.ino ?? 0n;
    const p = prev?.get(path);
    const statSame = p !== undefined && !inp.force && p.size === size && p.mtimeNs === mtimeNs && p.ino === ino && p.mode === mode && p.tracked === e.tracked;
    const a = attrs[e.raw];
    // A path check-attr was asked about and that came back without values has no attributes (any more).
    const lattrs: LinguistAttrs = a !== undefined ? pickAttrs(a) : ranAttrs ? {} : (p?.attrs ?? {});
    const reuseClass = statSame && !settingsChanged && sameAttrs(lattrs, (p as FileRec).attrs);
    const knownDirty = e.unmerged || (dirtySet !== null && e.tracked && dirtySet.has(e.raw));
    const indexBlob = e.tracked ? e.blob : "";

    // Unchanged entry (the warm rescan's common case): keep the very same record. Excluded untracked files are never
    // hashed, so their blob stays unknown ("").
    if (reuseClass) {
      const q = p as FileRec;
      const blobKnown = q.blob !== "" || q.excluded !== undefined;
      if (!q.racy && q.raw === e.raw && q.indexBlob === indexBlob && blobKnown && !knownDirty && (dirtySet === null || !q.dirty)) {
        q.seen = inp.gen;
        files.set(path, q);
        continue;
      }
    }
    unchanged = false;

    let rec: FileRec;
    if (reuseClass) {
      rec = { ...(p as FileRec), seen: inp.gen, raw: e.raw };
    } else {
      const c = classifyPathWith({ path, size, mode, attrs: lattrs }, inp.settings);
      rec = {
        path,
        raw: e.raw,
        blob: "",
        indexBlob: "",
        mode,
        size,
        mtimeNs,
        ino,
        racy: false,
        tracked: e.tracked,
        dirty: false,
        lang: c.lang,
        grammar: c.grammar,
        dialect: dialectOf(path, c.lang),
        class: c.class,
        scope: c.scope,
        rule: c.rule,
        attrs: lattrs,
        include: inp.settings.include.test(path),
        lines: 0,
        loc: 0,
        chars: 0,
        cjk: 0,
        tokensEst: 0,
        seen: inp.gen,
      };
      if (c.excluded !== undefined) rec.excluded = c.excluded;
    }
    rec.indexBlob = indexBlob;

    // Blob: index blob when known clean; the previous blob when the stat cache holds; otherwise unknown.
    if (e.tracked && !knownDirty && (dirtySet !== null || (statSame && !(p as FileRec).racy && !(p as FileRec).dirty))) {
      rec.blob = e.blob;
      rec.dirty = false;
    } else if (statSame && !(p as FileRec).racy && (p as FileRec).blob !== "") {
      rec.blob = (p as FileRec).blob;
      rec.dirty = e.tracked ? rec.blob !== e.blob : true;
    } else {
      rec.blob = e.tracked && !knownDirty ? e.blob : "";
      rec.dirty = !e.tracked || knownDirty;
      unknownBlob.add(path);
    }
    if (!reuseClass || unknownBlob.has(path)) rec.racy = mtimeNs >= racyFloorNs;
    else rec.racy = false;
    files.set(path, rec);
  }

  return {
    files,
    unknownBlob,
    git: { head, tree, branch, indexMtime, headMtime, attrsKey, objectFormat, gitDir },
    truncated,
    ranStatus,
    ranAttrs,
    unchanged: unchanged && prev !== null && files.size === prev.size,
  };
}

function pickAttrs(a: Record<string, string>): LinguistAttrs {
  const out: LinguistAttrs = {};
  const v = attrValue(a["linguist-vendored"]);
  const g = attrValue(a["linguist-generated"]);
  const d = attrValue(a["linguist-documentation"]);
  if (v !== undefined) out.vendored = v;
  if (g !== undefined) out.generated = g;
  if (d !== undefined) out.documentation = d;
  return out;
}
