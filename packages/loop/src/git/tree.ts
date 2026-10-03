// Job trees in the side repo: the in-memory head (`buildTree`, PT-19: hash-object + index-info + write-tree, no
// worktree), the base..head diff as hunks (the accept granularity), and the tree H′ of a partial selection.
import { type FileDiff, GIT_REFS, type GitOid, type HunkId, type JobId, MitoriError, type RepoPath } from "@mitori/core";
import { applySelected, fileDiff, rawHunks } from "./diff.ts";
import type { GitWorkspace, RawChange } from "./side.ts";

const dec = new TextDecoder();

/** True when the bytes look binary (a NUL in the first 8 KB, like git). */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

/** The base / head commits of a job (refs in the side repo). */
export async function jobCommits(g: GitWorkspace, job: JobId): Promise<{ base: GitOid; head: GitOid }> {
  const [base, head] = await Promise.all([g.rev(GIT_REFS.jobBase(job)), g.rev(GIT_REFS.jobHead(job))]);
  if (!base) throw new MitoriError("E_NOT_FOUND", `job ${job} has no base snapshot`, { params: { job } });
  return { base, head: head ?? base };
}

/** `buildTree`: head = base with `files` replaced (texts in blob form), committed on base; both refs set. */
export async function buildTree(g: GitWorkspace, job: JobId, base: GitOid, files: Record<RepoPath, string>, attempt = 1): Promise<GitOid> {
  await g.ready();
  const paths = Object.keys(files).sort();
  const modes = new Map((await g.lsTree(base, paths)).map((e) => [e.path, e.mode]));
  const changes = await Promise.all(
    paths.map(async (path) => {
      const mode = modes.get(path) ?? "100644";
      if (mode !== "100644" && mode !== "100755") throw new MitoriError("E_SCOPE_VIOLATION", `not a regular file: ${path}`, { params: { path, mode } });
      return { path, oid: await g.hashText(files[path] as string), mode };
    }),
  );
  const tree = await g.treeWith(base, changes);
  const head = await g.commitTree(tree, [base], `mitori job ${job} attempt ${attempt}\n`);
  await g.updateRef(GIT_REFS.jobBase(job), base);
  await g.updateRef(GIT_REFS.jobHead(job), head);
  return head;
}

/** Text of a blob, or null for an absent side / a binary blob. */
async function textOf(g: GitWorkspace, oid: GitOid | null): Promise<{ text: string | null; binary: boolean }> {
  if (oid === null) return { text: null, binary: false };
  const bytes = await g.blob(oid);
  return isBinary(bytes) ? { text: null, binary: true } : { text: dec.decode(bytes), binary: false };
}

const REGULAR = new Set(["100644", "100755"]);

/** Diff of `from..to` (file hunks with context 3; binary / symlink / submodule / mode-only changes carry no hunks). */
export async function diffCommits(g: GitWorkspace, from: GitOid, to: GitOid): Promise<FileDiff[]> {
  const changes = await g.rawDiff(from, to);
  const out: FileDiff[] = [];
  for (const c of changes) {
    const textual = (c.oldOid === null || REGULAR.has(c.oldMode)) && (c.newOid === null || REGULAR.has(c.newMode));
    const before = textual ? await textOf(g, c.oldOid) : { text: null, binary: true };
    const after = textual ? await textOf(g, c.newOid) : { text: null, binary: true };
    if (before.binary || after.binary) {
      out.push({ path: c.path, status: statusOf(c), binary: true, hunks: [], additions: 0, deletions: 0 });
      continue;
    }
    const d = fileDiff(c.path, c.oldOid === null ? null : (before.text ?? ""), c.newOid === null ? null : (after.text ?? ""));
    out.push({ ...d, status: statusOf(c) });
  }
  return out;
}

function statusOf(c: RawChange): FileDiff["status"] {
  return c.oldOid === null ? "added" : c.newOid === null ? "deleted" : "modified";
}

/**
 * The commit H′ that applies only the selected hunks of base..head on top of base (`all` ⇒ head itself). Changes
 * without hunks (binary, mode-only) belong to H′ only when every hunk of the job is selected.
 */
export async function selectionCommit(g: GitWorkspace, job: JobId, accept: readonly HunkId[] | "all"): Promise<{ commit: GitOid; full: boolean }> {
  const { base, head } = await jobCommits(g, job);
  if (accept === "all") return { commit: head, full: true };
  const wanted = new Set(accept);
  const changes = await g.rawDiff(base, head);
  const repl: { path: RepoPath; oid: GitOid | null; mode: string }[] = [];
  let full = true;
  let known = 0;
  const plans: { c: RawChange; ids: string[]; chosen: string[]; oldText: string; newText: string }[] = [];
  for (const c of changes) {
    const textual = (c.oldOid === null || REGULAR.has(c.oldMode)) && (c.newOid === null || REGULAR.has(c.newMode));
    const before = textual ? await textOf(g, c.oldOid) : { text: null, binary: true };
    const after = textual ? await textOf(g, c.newOid) : { text: null, binary: true };
    if (before.binary || after.binary) {
      plans.push({ c, ids: [], chosen: [], oldText: "", newText: "" });
      continue;
    }
    const oldText = before.text ?? "";
    const newText = after.text ?? "";
    const ids = rawHunks(c.path, oldText, newText).map((h) => h.hunk.id);
    const chosen = ids.filter((id) => wanted.has(id));
    known += chosen.length;
    if (chosen.length !== ids.length) full = false;
    plans.push({ c, ids, chosen, oldText, newText });
  }
  if (known !== wanted.size) {
    const all = new Set(plans.flatMap((p) => p.ids));
    const unknown = [...wanted].filter((id) => !all.has(id));
    throw new MitoriError("E_INVALID_INPUT", `unknown hunk ids: ${unknown.slice(0, 5).join(", ")}`, { params: { hunks: unknown.join(",") } });
  }
  if (full) return { commit: head, full: true };
  for (const p of plans) {
    const { c } = p;
    if (p.ids.length === 0) continue; // hunkless: only with the full selection
    if (p.chosen.length === 0) continue;
    if (p.chosen.length === p.ids.length) {
      repl.push({ path: c.path, oid: c.newOid, mode: c.newOid === null ? c.oldMode : c.newMode });
      continue;
    }
    const text = applySelected(c.path, p.oldText, p.newText, new Set(p.chosen));
    repl.push({ path: c.path, oid: await g.hashText(text), mode: c.newOid === null ? c.oldMode : c.newMode });
  }
  const tree = await g.treeWith(base, repl);
  return { commit: await g.commitTree(tree, [base], `mitori job ${job} selection\n`), full: false };
}
