// D4 accept / undo (spec §7.8–7.9, ADR-0006 R1-7/R1-8): the selected tree H′ is merged with a fresh snapshot S of
// the working tree (`merge-tree --write-tree`, nothing touches the user's index), the changed files are re-checked
// against S right before writing (TOCTOU, RT-21), journalled, written with SafeWriter kind `accept` (uncommitted),
// and checkpointed in the side repo. Undo restores byte-exactly what the accept replaced, leaves files the user
// edited since (`diverged`) unless forced, and snapshots the current state first when forced.
import { type AcceptReq, type CheckpointId, GIT_REFS, type GitOid, type Glob, type JobId, MitoriError, newId, type RepoPath, type UndoRes } from "@mitori/core";
import { type CheckpointFile, GIT_LIMITS, type MergePrecheck } from "../contract.ts";
import { changeRanges } from "./diff.ts";
import { splitZ } from "./exec.ts";
import { checkpointOf, type Journal, type JournalRow } from "./journal.ts";
import type { GitWorkspace } from "./side.ts";
import type { Snapshotter } from "./snapshot.ts";
import { isBinary, jobCommits, selectionCommit } from "./tree.ts";

const dec = new TextDecoder();
const enc = new TextEncoder();
const REGULAR = new Set(["100644", "100755"]);

/** What an accept wrote (beyond the contract's `{checkpoint, files}`). */
export interface AcceptOutcome {
  /** Checkpoint. */
  checkpoint: ReturnType<typeof checkpointOf>;
  /** Journal files. */
  files: CheckpointFile[];
  /** S→M change ranges per file (the `job.accepted` overlap hunks, spec §9.3). */
  hunks: { path: RepoPath; oldStart: number; oldLines: number; newStart: number; newLines: number }[];
  /** True when H′ = the job head (no hunk left pending or rejected). */
  full: boolean;
}

/** Auto-commit request (spec §7.8-11). */
export interface CommitRequest {
  /** First line + body. */
  message: string;
  /** `Mitori-Thread`, `Mitori-Agent`, `Mitori-Cost`, … */
  trailers: Record<string, string>;
}

/** The serialized accept / undo engine of one workspace. */
export class AcceptEngine {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly g: GitWorkspace,
    private readonly snap: Snapshotter,
    private readonly journal: Journal,
    private readonly deny: () => readonly Glob[],
  ) {}

  /** Accept and undo run one at a time, in arrival order (spec §7.8-1). */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** `merge-tree` of S and H′ on the job base. */
  private async merge(base: GitOid, ours: GitOid, theirs: GitOid): Promise<MergePrecheck> {
    const r = await this.g.side(["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", `--merge-base=${base}`, ours, theirs], { ok: [0, 1] });
    const f = splitZ(r.out);
    const tree = (f[0] ?? "").trim();
    if (r.code === 0) return { clean: true, tree, conflicts: [], ours };
    return { clean: false, conflicts: [...new Set(f.slice(1))].sort(), ours };
  }

  /** `GitSafety.precheck`: the selection against a (reusable) snapshot of the current working tree; ≤ 50 ms. */
  async precheck(job: JobId, sel: AcceptReq): Promise<MergePrecheck> {
    const { base } = await jobCommits(this.g, job);
    const { commit } = await selectionCommit(this.g, job, sel.accept);
    const s = await this.snap.snapshot(this.deny());
    return this.merge(base, s.commit, commit);
  }

  /** `GitSafety.accept`. `sel.accept` lists every hunk H′ contains (or `all`). */
  accept(job: JobId, sel: AcceptReq, opts: { autoCommit: CommitRequest | null; writeScope: readonly RepoPath[] }): Promise<AcceptOutcome> {
    return this.locked(() => this.acceptLocked(job, sel, opts));
  }

  private async acceptLocked(job: JobId, sel: AcceptReq, opts: { autoCommit: CommitRequest | null; writeScope: readonly RepoPath[] }): Promise<AcceptOutcome> {
    const { base } = await jobCommits(this.g, job);
    const { commit: hPrime, full } = await selectionCommit(this.g, job, sel.accept);
    const scope = new Set(opts.writeScope);
    for (let attempt = 0; ; attempt++) {
      // a retry after a divergence must not reuse the snapshot that just turned out stale
      const s = await this.snap.snapshot(this.deny(), { reuse: attempt === 0 });
      const m = await this.merge(base, s.commit, hPrime);
      if (!m.clean || !m.tree)
        throw new MitoriError("E_GIT_MERGE_CONFLICT", `the change conflicts with the working tree: ${m.conflicts.join(", ")}`, {
          params: { files: m.conflicts.join(",") },
        });
      const changes = await this.g.rawDiff(s.commit, m.tree);
      const outside = changes.filter((c) => !scope.has(c.path)).map((c) => c.path);
      if (outside.length > 0)
        throw new MitoriError("E_SCOPE_VIOLATION", `accept would write outside the write scope: ${outside.join(", ")}`, {
          params: { files: outside.join(",") },
        });
      for (const c of changes) {
        if ((c.oldOid !== null && !REGULAR.has(c.oldMode)) || (c.newOid !== null && !REGULAR.has(c.newMode)))
          throw new MitoriError("E_SCOPE_VIOLATION", `not a regular file: ${c.path}`, { params: { path: c.path } });
      }
      const paths = changes.map((c) => c.path);
      const now = await this.g.currentBlobs(paths);
      const diverged = changes.filter((c) => (now[c.path] ?? null) !== c.oldOid);
      if (diverged.length > 0) {
        if (attempt < GIT_LIMITS.acceptDivergeRetries) continue;
        throw new MitoriError("E_GIT_DIVERGED", `files changed while accepting: ${diverged.map((c) => c.path).join(", ")}`, {
          params: { files: diverged.map((c) => c.path).join(",") },
        });
      }
      // what is on disk now (restore source on a failed write) and the line endings the checkout uses
      const current = new Map<RepoPath, Uint8Array | null>();
      const eol: Record<string, "crlf"> = {};
      for (const c of changes) {
        const bytes = c.oldOid === null ? null : await this.g.deps.fs.read(`${this.g.root}/${c.path}`);
        current.set(c.path, bytes);
        const mode = await this.lineEnding(c.path, c.oldOid, bytes);
        if (mode === "crlf") eol[c.path] = "crlf";
      }
      const files: CheckpointFile[] = changes.map((c) => ({
        path: c.path,
        before: c.oldOid,
        after: c.newOid,
        mode: (c.newOid === null ? c.oldMode : c.newMode) === "100755" ? "100755" : "100644",
      }));
      const id = newId("checkpoint", this.g.deps.random) as CheckpointId;
      await this.journal.begin({ id, job, ref: GIT_REFS.checkpoint(id), before: s.commit, files, extra: Object.keys(eol).length > 0 ? { eol } : {} });
      const written: RepoPath[] = [];
      try {
        for (const c of changes) {
          if (c.newOid === null) await this.g.deps.safeWrite.remove(this.g.root, c.path, "accept");
          else await this.g.deps.safeWrite.write(this.g.root, c.path, await this.workingBytes(c.newOid, eol[c.path] === "crlf"), "accept");
          written.push(c.path);
        }
      } catch (e) {
        for (const p of written.reverse()) {
          const before = current.get(p) ?? null;
          try {
            if (before === null) await this.g.deps.safeWrite.remove(this.g.root, p, "accept");
            else await this.g.deps.safeWrite.write(this.g.root, p, before, "accept");
          } catch (restoreErr) {
            this.g.deps.log.error("accept rollback failed", { path: p, error: MitoriError.from(restoreErr).message });
          }
        }
        await this.journal.rolledBack(id);
        throw e;
      }
      this.snap.invalidate();
      const after = await this.g.commitTree(m.tree, [s.commit], `mitori accept ${job}\n`);
      await this.g.updateRef(GIT_REFS.checkpoint(id), s.commit);
      await this.g.updateRef(GIT_REFS.integration, after);
      await this.journal.finish(id, after);
      if (opts.autoCommit) {
        const commit = await this.commitPaths(
          paths,
          opts.autoCommit,
          changes.filter((c) => c.oldOid === null).map((c) => c.path),
        );
        if (commit) await this.journal.setCommit(id, commit);
      }
      const hunks: AcceptOutcome["hunks"] = [];
      for (const c of changes) {
        const oldText = c.oldOid ? await this.g.blob(c.oldOid) : new Uint8Array();
        const newText = c.newOid ? await this.g.blob(c.newOid) : new Uint8Array();
        if (isBinary(oldText) || isBinary(newText)) continue;
        for (const h of changeRanges(dec.decode(oldText), dec.decode(newText))) hunks.push({ path: c.path, ...h });
      }
      const row = this.journal.get(id) as JournalRow;
      return { checkpoint: checkpointOf(row), files, hunks, full };
    }
  }

  /** CRLF when the checked-out bytes are the blob with LF → CRLF (autocrlf / `eol=crlf`); any other conversion is refused. */
  private async lineEnding(path: RepoPath, blob: GitOid | null, bytes: Uint8Array | null): Promise<"raw" | "crlf"> {
    if (blob === null || bytes === null) {
      const autocrlf = await this.g.config();
      return autocrlf.mirror.some(([k, v]) => k.toLowerCase() === "core.autocrlf" && v === "true") ? "crlf" : "raw";
    }
    const stored = await this.g.blob(blob);
    if (equalBytes(stored, bytes)) return "raw";
    const text = dec.decode(stored);
    if (!text.includes("\r") && equalBytes(enc.encode(text.replace(/\n/g, "\r\n")), bytes)) return "crlf";
    throw new MitoriError("E_PRECONDITION", `${path} is checked out with a conversion mitori cannot reproduce`, { params: { path } });
  }

  private async workingBytes(blob: GitOid, crlf: boolean): Promise<Uint8Array> {
    const bytes = await this.g.blob(blob);
    if (!crlf || isBinary(bytes)) return bytes;
    return enc.encode(dec.decode(bytes).replace(/\r?\n/g, "\r\n"));
  }

  /**
   * `git commit --only` of `paths` in the USER's repository with trailers — the one place mitori lets the user's
   * hooks run (their choice; no `--no-verify`). A hook that refuses leaves the files uncommitted (null).
   */
  async commitPaths(paths: readonly RepoPath[], req: CommitRequest, added: readonly RepoPath[] = []): Promise<GitOid | null> {
    if (paths.length === 0) return null;
    // `commit --only` takes tracked paths only: a file the accept created is added first
    if (added.length > 0) await this.g.user(["add", "--", ...added], { env: { GIT_LITERAL_PATHSPECS: "1" } });
    const args = ["commit", "--only", "-q", "-F", "-"];
    for (const [k, v] of Object.entries(req.trailers)) args.push("--trailer", `${k}: ${v}`);
    const r = await this.g.user([...args, "--", ...paths], {
      input: req.message,
      userHooks: true,
      identity: "user",
      ok: [0, 1],
      env: { GIT_LITERAL_PATHSPECS: "1" },
      timeoutMs: 120_000,
    });
    if (r.code !== 0) {
      this.g.deps.log.warn("auto-commit refused; the files stay uncommitted", { stderr: r.err.slice(-3).join(" | ").slice(0, 300) });
      return null;
    }
    return this.g.head();
  }

  /** `GitSafety.undo`. */
  undo(ck: CheckpointId, force: boolean): Promise<UndoRes> {
    return this.locked(() => this.undoLocked(ck, force));
  }

  private async undoLocked(ck: CheckpointId, force: boolean): Promise<UndoRes> {
    await this.g.ready();
    const row = this.journal.get(ck);
    if (!row || row.state !== "done") throw new MitoriError("E_NOT_FOUND", `checkpoint ${ck} not found`, { params: { checkpoint: ck } });
    if (row.undoneAt) throw new MitoriError("E_PRECONDITION", `checkpoint ${ck} was already undone`, { params: { checkpoint: ck } });
    await this.requireObjects(row);
    if (row.commit) return this.revertCommit(row);
    const paths = row.files.map((f) => f.path);
    const now = await this.g.currentBlobs(paths);
    const diverged = row.files.filter((f) => (now[f.path] ?? null) !== f.after).map((f) => f.path);
    if (diverged.length > 0 && !force) return { checkpoint: checkpointOf(row), restored: [], diverged };
    if (diverged.length > 0) {
      const pre = await this.snap.snapshot(this.deny(), { reuse: false });
      await this.g.updateRef(GIT_REFS.preForce(ck), pre.commit);
      await this.journal.patchExtra(ck, { preForce: pre.commit });
    }
    const restored: RepoPath[] = [];
    for (const f of row.files) {
      if (f.before === null) await this.g.deps.safeWrite.remove(this.g.root, f.path, "accept");
      else await this.g.deps.safeWrite.write(this.g.root, f.path, await this.workingBytes(f.before, row.extra.eol?.[f.path] === "crlf"), "accept");
      restored.push(f.path);
    }
    this.snap.invalidate();
    const undoneAt = await this.journal.undone(ck);
    return { checkpoint: { ...checkpointOf(row), undoneAt }, restored, diverged: [] };
  }

  /** Every object undo needs still exists (the user may have pruned the alternates DB) [SEC-18, ADR-0012 6]. */
  private async requireObjects(row: JournalRow): Promise<void> {
    const oids = [...new Set(row.files.flatMap((f) => [f.before, f.after]).filter((o): o is GitOid => o !== null))];
    if (oids.length === 0) return;
    const r = await this.g.side(["cat-file", "--batch-check"], { input: `${oids.join("\n")}\n` });
    const missing = r.out.split("\n").filter((l) => l.endsWith(" missing"));
    if (missing.length > 0)
      throw new MitoriError("E_GIT_FAILED", `checkpoint ${row.id} can no longer be restored: ${missing.length} objects were pruned`, {
        params: { reason: "checkpoint_pruned", checkpoint: row.id, createdAt: row.createdAt },
      });
  }

  /** Undo of an auto-committed accept: `git revert` as a new commit (history is never rewritten), trailer `Mitori-Undo`. */
  private async revertCommit(row: JournalRow): Promise<UndoRes> {
    const commit = row.commit as GitOid;
    const paths = row.files.map((f) => f.path);
    const rv = await this.g.user(["revert", "--no-commit", commit], { userHooks: true, identity: "user", ok: [0, 1] });
    if (rv.code !== 0) {
      await this.g.user(["revert", "--abort"], { ok: [0, 1, 128] });
      throw new MitoriError("E_GIT_MERGE_CONFLICT", `cannot revert ${commit.slice(0, 7)}: the files changed since`, { params: { files: paths.join(",") } });
    }
    const subject = (await this.g.user(["log", "-1", "--format=%s", commit])).out.trim();
    const done = await this.commitPaths(paths, { message: `Revert "${subject}"\n\nThis reverts commit ${commit}.\n`, trailers: { "Mitori-Undo": row.id } });
    if (!done) throw new MitoriError("E_GIT_FAILED", "the revert commit was refused by a hook", { params: { reason: "hook" } });
    this.snap.invalidate();
    const undoneAt = await this.journal.undone(row.id);
    return { checkpoint: { ...checkpointOf(row), undoneAt }, restored: paths, diverged: [] };
  }

  /** `GitSafety.recoverAccept`: finish, forget or roll back an accept interrupted mid-write (spec §7.11). */
  recover(ck: CheckpointId): Promise<"completed" | "not_applied" | "rolled_back"> {
    return this.locked(async () => {
      await this.g.ready();
      const row = this.journal.get(ck);
      if (!row) throw new MitoriError("E_NOT_FOUND", `checkpoint ${ck} not found`, { params: { checkpoint: ck } });
      if (row.state === "done") return "completed";
      if (row.state === "rolled_back") return "rolled_back";
      const now = await this.g.currentBlobs(row.files.map((f) => f.path));
      const atAfter = row.files.filter((f) => (now[f.path] ?? null) === f.after);
      const atBefore = row.files.filter((f) => (now[f.path] ?? null) === f.before);
      if (atAfter.length === row.files.length) {
        const s = row.before;
        const changes = row.files.map((f) => ({ path: f.path, oid: f.after, mode: f.mode }));
        const tree = await this.g.treeWith(s, changes);
        const after = await this.g.commitTree(tree, [s], `mitori accept ${row.job} (recovered)\n`);
        await this.g.updateRef(GIT_REFS.checkpoint(ck), s);
        await this.g.updateRef(GIT_REFS.integration, after);
        await this.journal.finish(ck, after);
        return "completed";
      }
      if (atBefore.length === row.files.length) {
        await this.journal.drop(ck);
        return "not_applied";
      }
      for (const f of atAfter) {
        if (f.before === null) await this.g.deps.safeWrite.remove(this.g.root, f.path, "accept");
        else await this.g.deps.safeWrite.write(this.g.root, f.path, await this.workingBytes(f.before, row.extra.eol?.[f.path] === "crlf"), "accept");
      }
      this.snap.invalidate();
      await this.journal.rolledBack(ck);
      return "rolled_back";
    });
  }

  /**
   * `GitSafety.exportPatch` (remote-readonly, spec §7.8): H′ as one commit with message + trailers, `format-patch`
   * written by git into the temp dir (bytes stay exact), secret-scanned, then stored as `patches/<job>.patch`.
   */
  async exportPatch(job: JobId, sel: AcceptReq, req: CommitRequest, secrets: { scan(text: string): unknown[] }): Promise<string> {
    const { base } = await jobCommits(this.g, job);
    const { commit } = await selectionCommit(this.g, job, sel.accept);
    const tree = (await this.g.rev(`${commit}^{tree}`)) as GitOid;
    const trailers = Object.entries(req.trailers).map(([k, v]) => `${k}: ${v}`);
    const message = `${req.message.replace(/\s+$/u, "")}\n${trailers.length > 0 ? `\n${trailers.join("\n")}\n` : ""}`;
    const c = await this.g.commitTree(tree, [base], message);
    const t = this.g.tempPath("patch");
    await this.g.deps.safeWrite.write(this.g.deps.home, `${this.g.tmpRel}/.keep`, "", "home");
    try {
      await this.g.side(["format-patch", "-1", "--no-signature", "--no-stat", `--output=${t.abs}`, c]);
      const bytes = await this.g.deps.fs.read(t.abs);
      if (secrets.scan(dec.decode(bytes)).length > 0)
        throw new MitoriError("E_SECRET_DETECTED", "the patch contains a secret-looking line", { params: { job } });
      const rel = `repos/${this.g.deps.ws.key}/patches/${job}.patch`;
      await this.g.deps.safeWrite.write(this.g.deps.home, rel, bytes, "home");
      return `${this.g.deps.home}/${rel}`;
    } finally {
      await this.g.dropTemp(t.rel);
    }
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
