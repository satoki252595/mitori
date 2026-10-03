// `update(changes)` (indexer spec §10.2): fold the watcher batch, stat, read on the main thread, hash, short-circuit
// unchanged content, parse the rest on the warm Worker (with `source`), diff symbols, detect same-batch renames,
// pin the new dirty text, persist in one transaction and emit `index.changed`.
import type { IndexDelta, RepoPath, SymbolChange } from "@mitori/core";
import type { FsChange } from "../contract.ts";
import { classifyPathWith } from "../inventory/classify.ts";
import { dialectOf } from "../lang/detect.ts";
import type { ParseItemExt, ParseResultExt } from "../parse/protocol.ts";
import { absOf, applyParsed, type Core, cacheKeys, needsContent, settingsOf, tokensOf } from "./core.ts";
import { contentKey, type FileRec, type Parsed } from "./model.ts";
import { loadParsed, persist, yieldToLoop } from "./persist.ts";
import { applyResult, itemFor, snapshotOf } from "./scan.ts";

/**
 * Fold a watcher batch into the set of touched paths (the last `source` of a path wins; a later event without one
 * drops it, the bytes it carried may be stale). Event kinds are only hints (CR m1-29): `update()` stats every path, so
 * `add`→`delete` of a path that was indexed before is still a deletion. `git` is reported separately.
 */
export function foldChanges(changes: readonly FsChange[]): { files: Map<RepoPath, { source?: Uint8Array }>; git: boolean } {
  const files = new Map<RepoPath, { source?: Uint8Array }>();
  let git = false;
  for (const c of changes) {
    if (c.kind === "git") git = true;
    else files.set(c.path, c.kind !== "delete" && c.source !== undefined ? { source: c.source } : {});
  }
  return { files, git };
}

/**
 * Indexed paths below `dirs` — batch paths that are gone or directories without being indexed files (a directory
 * renamed away or moved out of the tree is ONE event for the directory, CR m1-29). One pass over the index.
 */
function underDirectories(core: Core, dirs: readonly RepoPath[], skip: ReadonlySet<RepoPath>): RepoPath[] {
  if (dirs.length === 0) return [];
  const prefixes = dirs.map((d) => `${d}/`);
  const out: RepoPath[] = [];
  for (const p of core.files.keys()) if (!skip.has(p) && prefixes.some((x) => p.startsWith(x))) out.push(p);
  return out;
}

/** Symbol-level diff of one file by qualname. */
export function diffSymbols(path: RepoPath, before: Parsed | null, after: Parsed | null): SymbolChange {
  const a = new Map((before?.symbols ?? []).map((s) => [s.qualname, s.sigHash]));
  const b = new Map((after?.symbols ?? []).map((s) => [s.qualname, s.sigHash]));
  const added: string[] = [];
  const removed: string[] = [];
  const sigChanged: string[] = [];
  for (const [q, h] of b) {
    const old = a.get(q);
    if (old === undefined) added.push(q);
    else if (old !== h) sigChanged.push(q);
  }
  for (const q of a.keys()) if (!b.has(q)) removed.push(q);
  return { path, added, removed, sigChanged };
}

const parsedOfRec = (core: Core, r: FileRec | undefined): Parsed | null =>
  r === undefined || r.key === undefined || r.blob === "" ? null : (core.parsed.get(contentKey(r.blob, r.key)) ?? null);

/** Build the delta between two file maps (shared with the `git` → warm-scan path). */
export function deltaBetween(
  core: Core,
  before: ReadonlyMap<RepoPath, FileRec>,
  after: ReadonlyMap<RepoPath, FileRec>,
  touched: Iterable<RepoPath>,
): Omit<IndexDelta, "snapshot" | "ifaceChanged" | "membershipChanged" | "factsChanged" | "factKinds" | "structureRefreshed"> {
  const changed: IndexDelta["changed"] = [];
  const symbols: SymbolChange[] = [];
  const bodyOnly: RepoPath[] = [];
  const added = new Map<string, RepoPath>();
  const deleted = new Map<string, RepoPath>();
  for (const path of touched) {
    const a = before.get(path);
    const b = after.get(path);
    const oldBlob = a?.blob || null;
    const newBlob = b?.blob || null;
    if (oldBlob === newBlob && (a === undefined) === (b === undefined)) continue;
    changed.push({ path, oldBlob, newBlob });
    if (a === undefined && newBlob !== null) added.set(newBlob, path);
    if (b === undefined && oldBlob !== null) deleted.set(oldBlob, path);
    const pa = parsedOfRec(core, a);
    const pb = parsedOfRec(core, b);
    if (pa === null && pb === null) continue;
    const d = diffSymbols(path, pa, pb);
    if (d.added.length === 0 && d.removed.length === 0 && d.sigChanged.length === 0) {
      if (a !== undefined && b !== undefined) bodyOnly.push(path);
    } else symbols.push(d);
  }
  const renames: IndexDelta["renames"] = [];
  for (const [blob, from] of deleted) {
    const to = added.get(blob);
    if (to !== undefined) renames.push({ from, to });
  }
  changed.sort((x, y) => (x.path < y.path ? -1 : 1));
  return { changed, renames, bodyOnly: bodyOnly.sort(), symbols };
}

export async function runUpdate(core: Core, changes: readonly FsChange[], warmScan: () => Promise<unknown>, signal?: AbortSignal): Promise<IndexDelta> {
  const { deps } = core;
  const folded = foldChanges(changes);
  const before = new Map(core.files);
  if (folded.git) {
    await warmScan();
    const touched = new Set<RepoPath>([...before.keys(), ...core.files.keys()]);
    return finish(core, before, touched, true);
  }
  const set = settingsOf(deps.settings());
  const objectFormat = core.git?.objectFormat ?? (await deps.git.objectFormat());
  const nowMs = deps.clock.now();
  const items: ParseItemExt[] = [];
  const recs: FileRec[] = [];
  const pins: { blob: string; bytes: Uint8Array }[] = [];

  const touched = new Set<RepoPath>(folded.files.keys());
  // A batch path that is not an indexed file and is gone (or a directory) may be a directory prefix: everything indexed
  // below it is re-checked by stat after the batch's own paths (CR m1-29) — deleted when gone, re-read when changed.
  const dirs: RepoPath[] = [];
  const queue: [RepoPath, { source?: Uint8Array }][] = [...folded.files];
  for (let qi = 0; ; qi++) {
    if (qi === folded.files.size)
      for (const p of underDirectories(core, dirs, touched)) {
        touched.add(p);
        queue.push([p, {}]);
      }
    if (qi >= queue.length) break;
    const [path, ch] = queue[qi] as [RepoPath, { source?: Uint8Array }];
    const old = core.files.get(path);
    const raw = old?.raw ?? path;
    const abs = absOf(core, { raw });
    // The stat decides (spec §10.2-3), not the event kind: an editor's rename-save reports `delete` for a file that
    // exists again by the time the batch is applied, and an `add` of an indexed path is a change (old blob kept).
    const st = deps.fs.stat(abs);
    if (st === null || st.isDir) {
      if (old === undefined) dirs.push(path);
      else core.files.delete(path);
      continue;
    }
    const mode = st.isSymlink ? "120000" : (old?.mode ?? "100644");
    const mtimeNs = (st.mtimeNs / 1_000n) * 1_000n;
    if (old !== undefined && !old.racy && old.size === st.size && old.mtimeNs === mtimeNs && old.ino === st.ino && ch.source === undefined) continue; // touch only
    const c = classifyPathWith({ path, size: st.size, mode, attrs: old?.attrs ?? {} }, set.compiled);
    const r: FileRec = {
      path,
      raw,
      blob: old?.blob ?? "",
      indexBlob: old?.indexBlob ?? "",
      mode,
      size: st.size,
      mtimeNs,
      ino: st.ino,
      racy: mtimeNs >= BigInt(nowMs - 3_000) * 1_000_000n,
      // CR-PENDING(WP-02): GitReader has no check-ignore; a new path is treated as untracked-not-ignored until the
      // next warm scan (docs/design/cr-requests/WP-02.md §3).
      tracked: old?.tracked ?? false,
      dirty: true,
      lang: c.lang,
      grammar: c.grammar,
      dialect: dialectOf(path, c.lang),
      class: c.class,
      scope: c.scope,
      rule: c.rule,
      attrs: old?.attrs ?? {},
      include: set.compiled.include.test(path),
      lines: 0,
      loc: 0,
      chars: 0,
      cjk: 0,
      tokensEst: 0,
      seen: core.gen,
    };
    if (c.excluded !== undefined) r.excluded = c.excluded;
    if (!needsContent(r)) {
      if (r.tracked && r.blob === "") r.blob = r.indexBlob;
      r.tokensEst = tokensOf(core, r);
      core.files.set(path, r);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = ch.source ?? (await deps.fs.read(abs));
    } catch {
      continue;
    }
    const blob = deps.hasher.gitBlob(bytes, objectFormat);
    deps.metrics.inc("idx.files.hashed");
    r.blob = blob;
    r.dirty = !r.tracked || blob !== r.indexBlob;
    // Shadow workspaces keep texts only for anchored blobs (`pinBlobs`, CR m1-32); the others pin every dirty text.
    if (r.dirty && deps.ws.kind !== "shadow") pins.push({ blob, bytes });
    if (old !== undefined && old.blob === blob && old.key !== undefined && old.class === r.class) {
      // Re-save of identical content: keep the S1 output, refresh the stat cache.
      core.files.set(path, { ...old, size: r.size, mtimeNs: r.mtimeNs, ino: r.ino, racy: r.racy, seen: core.gen });
      continue;
    }
    let hit: Parsed | null = null;
    for (const k of cacheKeys(core, r)) {
      hit = core.parsed.get(contentKey(blob, k)) ?? loadParsed(core, blob, k);
      if (hit !== null) break;
    }
    if (hit !== null) {
      applyParsed(core, r, hit);
      core.files.set(path, r);
      continue;
    }
    items.push(itemFor(core, r, blob, bytes));
    recs.push(r);
  }

  if (items.length > 0) {
    const run = await core.pool.run(items, Math.max(1, core.pool.size()), signal);
    for (let i = 0; i < items.length; i++) {
      const r = recs[i] as FileRec;
      applyResult(core, r, run.results[i] as ParseResultExt, items[i] as ParseItemExt);
      core.files.set(r.path, r);
    }
  }
  // Queued, not awaited: the pin store serves the texts from memory until the write lands (update() latency).
  if (pins.length > 0)
    core.pin.saveMany(pins).catch((err: unknown) => {
      core.log.warn("pin save failed", { error: err instanceof Error ? err.message : String(err) });
    });
  return finish(core, before, touched, false);
}

async function finish(core: Core, before: ReadonlyMap<RepoPath, FileRec>, touched: ReadonlySet<RepoPath>, fromScan: boolean): Promise<IndexDelta> {
  const base = deltaBetween(core, before, core.files, touched);
  for (const p of base.changed) core.symCache.delete(p.path);
  for (const rn of base.renames) core.renames.set(rn.from, rn.to);
  while (core.renames.size > 1_000) core.renames.delete(core.renames.keys().next().value as RepoPath);
  if (!fromScan) core.snap = snapshotOf(core);
  const paths = base.changed.map((c) => c.path);
  const later =
    paths.length > 0 && !fromScan
      ? await core.stages.update(paths)
      : { ifaceChanged: [], membershipChanged: [], factsChanged: false, factKinds: [], structureRefreshed: false };
  if (!fromScan && touched.size > 0) {
    // The write (one transaction) is queued behind any background persistence and not awaited: the in-memory index
    // already answers, and right after a cold scan that persistence can take hundreds of ms (save → badge ≤ 50 ms).
    // It starts after a turn of the event loop, so the caller (reanchor → doc.freshness) runs first, and compares only
    // the paths updates touched (stat-only refreshes included; queued updates coalesce into one write). A failed write
    // is logged, never left in the chain: its paths stay in `unsaved` and the next write retries them.
    for (const p of touched) core.unsaved.add(p);
    core.persisting = core.persisting
      .then(
        () =>
          yieldToLoop().then(async () => {
            if (core.unsaved.size === 0) return;
            const paths = [...core.unsaved];
            core.unsaved.clear();
            try {
              await persist(core, { single: true, paths });
            } catch (err) {
              for (const p of paths) core.unsaved.add(p);
              throw err;
            }
          }),
        () => undefined,
      )
      .catch((err: unknown) => {
        core.log.warn("persist failed", { error: err instanceof Error ? err.message : String(err) });
      });
  }
  const delta: IndexDelta = { snapshot: core.snap as NonNullable<Core["snap"]>, ...base, ...later };
  if (paths.length > 0) core.deps.events.emit({ type: "index.changed", paths, ifaceChanged: later.ifaceChanged });
  return delta;
}
