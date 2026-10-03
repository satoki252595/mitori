// Gates of one job tree (spec §7.6, ADR-0006 R1-6, ADR-0013). Two stages:
//   1. format (autofix) — on temp copies of the changed files (patch mode: no worktree needed) or in place in the job
//      worktree (agent mode);
//   2. checks (lint / typecheck / test / build / custom) — they need the whole tree, so they run in the job worktree,
//      created lazily for a patch-mode job (only when a check can actually run) and synced to the tree under test.
// Trust is enforced first (untrusted ⇒ `untrusted` + one `trust.request`); repo-code gates without an OS sandbox
// return `pending_consent` until the human consented (the runner decides). A failing check is re-run on the base: a
// failure that was already there is not the AI's (`error`, no repair); only lines the change added are kept.
// After a check the worktree is put back to the tree under test (a test that writes files must not change the head).
import { type GateResult, type GateSpec, type GitOid, type JobId, MitoriError, newId, type RepoPath, type TrustRequest } from "@mitori/core";
import type { RunnerCore } from "../jobs/core.ts";
import { runOnCopies } from "./copies.ts";
import { supportFiles } from "./detect.ts";
import { gatePreview, gateTrust } from "./trust.ts";

const dec = new TextDecoder();
/** Symlinks the worktree has on purpose (dependency links, spec §7.3): never removed by a sync. */
const DEP_LINK_RE = /(?:^|\/)(?:node_modules|\.venv|venv)$/;

/** The texts of a tree under test: every path that differs from the base (null = absent). */
export type TreeTexts = Readonly<Record<RepoPath, string | null>>;

/**
 * Split `specs` by trust (gates/trust.ts: the untrusted rest is asked for once, as one set). `all` is the job's whole
 * gate list: the set a human trusted is judged on it, also when only some of its gates run now (a consent run).
 */
export function trustSplit(core: RunnerCore, specs: readonly GateSpec[], all: readonly GateSpec[] = specs): { runnable: GateSpec[]; results: GateResult[] } {
  const results: GateResult[] = [];
  const runnable: GateSpec[] = [];
  const universe = [...all, ...specs.filter((s) => !all.some((a) => a.id === s.id))];
  const { trusted, rest, setHash, set } = gateTrust((h) => core.deps.trust("gates", h), core.deps.hasher.sha256, universe);
  const ok = new Map(universe.map((s, i) => [s.id, trusted[i] === true]));
  for (const spec of specs) {
    if (ok.get(spec.id)) runnable.push(spec);
    else results.push({ gate: spec.id, status: "untrusted", ms: 0 });
  }
  if (setHash && set !== "trusted" && !core.asked.has(setHash)) {
    core.asked.add(setHash);
    core.deps.events.emit({
      type: "trust.request",
      request: {
        id: newId("trust", core.deps.random) as TrustRequest["id"],
        item: "gates",
        hash: setHash,
        preview: rest.map(gatePreview).join("\n"),
        status: set === "denied" ? "denied" : "pending",
      },
    });
  }
  return { runnable, results };
}

const byId = (a: GateResult, b: GateResult) => (a.gate < b.gate ? -1 : 1);

/** Stage 1 on temp copies (patch mode): results + the formatted texts that differ. */
export async function formatOnCopies(
  core: RunnerCore,
  id: JobId,
  specs: readonly GateSpec[],
  files: Readonly<Record<RepoPath, string>>,
  head: GitOid,
  consent: boolean,
  signal: AbortSignal,
): Promise<{ results: GateResult[]; formatted: Record<RepoPath, string> }> {
  if (specs.length === 0) return { results: [], formatted: {} };
  const tree = await core.deps.git.ws.lsTree(head);
  const allPaths = tree.map((e) => e.path);
  const oid = new Map(tree.map((e) => [e.path, e.oid]));
  const support: Record<RepoPath, string> = {};
  for (const spec of specs) {
    for (const p of supportFiles(spec, allPaths)) {
      const o = oid.get(p);
      if (o && !(p in files)) support[p] = await core.deps.git.blobText(o);
    }
  }
  const out = await runOnCopies(
    { runner: core.deps.gates, safeWrite: core.deps.safeWrite, fs: core.deps.fs, home: core.deps.home, ws: core.deps.ws.key },
    id,
    specs,
    files,
    support,
    { consent, sandbox: core.deps.sandbox },
    signal,
  );
  return { results: out.results, formatted: out.files };
}

/** Home-relative path of an absolute path under `~/.mitori`. */
function homeRel(core: RunnerCore, abs: string): string {
  const prefix = `${core.deps.home}/`;
  if (!abs.startsWith(prefix)) throw new MitoriError("E_PATH_OUTSIDE", "not under ~/.mitori", { params: { path: abs } });
  return abs.slice(prefix.length);
}

/**
 * Make the worktree's files equal the tree under test: `want` (relative to `base`) is written where the disk differs,
 * paths the worktree index has changed from the base but `want` does not are reset to the base, and every other
 * difference the worktree shows against its index (files a gate or a tool wrote) is undone — tracked files from the
 * index, new untracked files removed (dependency links stay). Ignored files are never touched.
 */
export async function syncWorktree(core: RunnerCore, wt: string, base: GitOid, want: TreeTexts): Promise<void> {
  const g = core.deps.git.ws;
  const target = new Map<RepoPath, string | null>(Object.entries(want));
  const indexTree = (await g.inWorktree(wt, ["write-tree"])).out.trim();
  for (const c of await g.rawDiff(base, indexTree)) {
    if (target.has(c.path)) continue;
    target.set(c.path, c.oldOid ? dec.decode(await g.blob(c.oldOid)) : null);
  }
  const rel = homeRel(core, wt);
  for (const [p, text] of target) {
    const abs = `${wt}/${p}`;
    const st = core.deps.fs.stat(abs);
    if (text === null) {
      if (st) await core.deps.safeWrite.remove(core.deps.home, `${rel}/${p}`, "home");
      continue;
    }
    if (st?.isFile && dec.decode(await core.deps.fs.read(abs)) === text) continue;
    await core.deps.safeWrite.write(core.deps.home, `${rel}/${p}`, text, "home");
  }
  const st = await g.inWorktree(wt, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]);
  const restore: RepoPath[] = [];
  for (const entry of st.out.split("\0")) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const p = entry.slice(3).normalize("NFC");
    if (target.has(p)) continue;
    if (code === "??") {
      const s = core.deps.fs.stat(`${wt}/${p.replace(/\/$/, "")}`);
      if (s?.isSymlink && DEP_LINK_RE.test(p.replace(/\/$/, ""))) continue;
      await core.deps.safeWrite.remove(core.deps.home, `${rel}/${p.replace(/\/$/, "")}`, "home");
    } else restore.push(p);
  }
  if (restore.length > 0) await g.inWorktree(wt, ["checkout-index", "-f", "-q", "-z", "--stdin"], { input: `${restore.join("\0")}\0` });
}

/** The job worktree for checks: the existing one, or a new one at `base` (with dependency links) recorded on the job. */
export async function ensureWorktree(core: RunnerCore, id: JobId, base: GitOid): Promise<string> {
  const rec = core.get(id);
  if (rec.job.worktree && core.deps.fs.stat(rec.job.worktree)?.isDir) return rec.job.worktree;
  const wt = await core.deps.git.createWorktree(id, base, { dependencyLinks: true });
  await core.update(id, "job.worktree", (r) => {
    r.job.worktree = wt.path;
  });
  return wt.path;
}

/** Normalized failure lines (positions dropped) for the base comparison. */
const normalized = (excerpt: string | undefined) =>
  new Set(
    (excerpt ?? "")
      .split("\n")
      .map((l) => l.replace(/:\d+(?::\d+)?/g, ":#").trim())
      .filter((l) => l.length > 0),
  );

/**
 * Stage 2 in the worktree: sync to `want`, run the checks (typecheck → test, stop at the first failure), compare a
 * failure with the base, and sync back to `want`. `changed` = the paths the job changed (the gates' file filter).
 */
export async function checksInWorktree(
  core: RunnerCore,
  wt: string,
  base: GitOid,
  want: TreeTexts,
  specs: readonly GateSpec[],
  changed: readonly RepoPath[],
  consent: boolean,
  signal: AbortSignal,
): Promise<GateResult[]> {
  if (specs.length === 0) return [];
  const opts = { consent, sandbox: core.deps.sandbox };
  await syncWorktree(core, wt, base, want);
  let results: GateResult[];
  try {
    results = await core.deps.gates.run(wt, [...specs], [...changed], opts, signal);
    const failed = results.find((r) => r.status === "fail");
    const spec = failed ? specs.find((s) => s.id === failed.gate) : undefined;
    if (failed && spec && !signal.aborted) {
      // the same gate on the base: what already failed there is not the change's fault
      await syncWorktree(core, wt, base, {});
      const [atBase] = await core.deps.gates.run(wt, [spec], [...changed], { ...opts, consent: true }, signal);
      if (atBase?.status === "fail") {
        const before = normalized(atBase.excerpt);
        const added = (failed.excerpt ?? "").split("\n").filter((l) => l.trim() !== "" && !before.has(l.replace(/:\d+(?::\d+)?/g, ":#").trim()));
        if (added.length === 0) {
          failed.status = "error";
          failed.excerpt = `(変更前から失敗しています — この変更による失敗ではありません)\n${failed.excerpt ?? ""}`.trim();
        } else failed.excerpt = added.join("\n");
      }
    }
  } finally {
    await syncWorktree(core, wt, base, want).catch((e: unknown) =>
      core.deps.log.warn("worktree sync after gates failed", { worktree: wt, error: MitoriError.from(e).message }),
    );
  }
  return results;
}

/** Texts of `head` for every path changed from `base` (null = deleted). */
export async function treeTexts(core: RunnerCore, base: GitOid, head: GitOid): Promise<Record<RepoPath, string | null>> {
  const out: Record<RepoPath, string | null> = {};
  for (const c of await core.deps.git.ws.rawDiff(base, head)) out[c.path] = c.newOid ? dec.decode(await core.deps.git.ws.blob(c.newOid)) : null;
  return out;
}

/**
 * Every gate of a patch-mode tree (`files` = head texts of the changed paths, relative to `base`): format on temp
 * copies, then the checks in the lazily created worktree on the formatted texts. `formatted` = texts the formatter
 * changed (the caller rebuilds the head). The checks are skipped (`skipped`) after a format failure.
 */
export async function gatePatchTree(
  core: RunnerCore,
  id: JobId,
  specs: readonly GateSpec[],
  base: GitOid,
  files: Readonly<Record<RepoPath, string>>,
  head: GitOid,
  opts: { consent: boolean; only?: readonly string[] },
  signal: AbortSignal,
): Promise<{ results: GateResult[]; formatted: Record<RepoPath, string> }> {
  const chosen = specs.filter((s) => !opts.only || opts.only.includes(s.id));
  const { runnable, results } = trustSplit(core, chosen, core.store.get(id)?.extra.gateSpecs ?? specs);
  const format = runnable.filter((s) => s.kind === "format");
  const checks = runnable.filter((s) => s.kind !== "format");
  const f = await formatOnCopies(core, id, format, files, head, opts.consent, signal);
  results.push(...f.results);
  if (checks.length > 0) {
    const broken = f.results.some((r) => r.status === "fail" || r.status === "timeout");
    // a check that cannot run here (no consent, no sandbox) needs no worktree
    const willRun = checks.filter((s) => !(s.executesRepoCode && core.deps.sandbox === "none" && !opts.consent));
    if (broken) results.push(...checks.map((s) => ({ gate: s.id, status: "skipped" as const, ms: 0 })));
    else if (willRun.length === 0) results.push(...checks.map((s) => ({ gate: s.id, status: "pending_consent" as const, ms: 0 })));
    else {
      const wt = await ensureWorktree(core, id, base);
      const want = { ...files, ...f.formatted };
      const changed = Object.keys(want).sort();
      results.push(...(await checksInWorktree(core, wt, base, want, checks, changed, opts.consent, signal)));
    }
  }
  return { results: results.sort(byId), formatted: f.formatted };
}
