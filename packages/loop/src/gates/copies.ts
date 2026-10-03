// Format gates on temp copies (ADR-0006 R1-6, PT-19): a patch-mode job has no worktree — the changed files of the
// in-memory head plus the configs the formatter reads are written to `~/.mitori/repos/<ws>/tmp/<job>/tree`, the
// gates run there, and the formatted texts come back for a rebuilt head.
import type { Cancel, FsReader, GateResult, GateSpec, JobId, RepoPath, SafeWriter } from "@mitori/core";
import type { GateRunner } from "../contract.ts";

/** Ports. */
export interface CopyDeps {
  runner: GateRunner;
  safeWrite: SafeWriter;
  fs: FsReader;
  /** Absolute realpath of `~/.mitori`. */
  home: string;
  /** Workspace key. */
  ws: string;
}

const dec = new TextDecoder();

/** `repos/<ws>/tmp/<job>` relative to home. */
export const jobTmpRel = (ws: string, job: JobId): string => `repos/${ws}/tmp/${job}`;

/** Run `gates` on copies of `files` (the head texts of the changed paths) with `support` files beside them. */
export async function runOnCopies(
  deps: CopyDeps,
  job: JobId,
  gates: readonly GateSpec[],
  files: Readonly<Record<RepoPath, string>>,
  support: Readonly<Record<RepoPath, string>>,
  opts: { consent: boolean; sandbox: "sandbox-exec" | "bwrap" | "none" },
  signal: Cancel,
): Promise<{ results: GateResult[]; files: Record<RepoPath, string> }> {
  const rel = `${jobTmpRel(deps.ws, job)}/tree`;
  const tree = `${deps.home}/${rel}`;
  await deps.safeWrite.remove(deps.home, rel, "home");
  try {
    for (const [p, text] of Object.entries(support)) if (!(p in files)) await deps.safeWrite.write(deps.home, `${rel}/${p}`, text, "home");
    for (const [p, text] of Object.entries(files)) await deps.safeWrite.write(deps.home, `${rel}/${p}`, text, "home");
    const changed = Object.keys(files).sort();
    const results = await deps.runner.run(tree, [...gates], changed, opts, signal);
    const out: Record<RepoPath, string> = {};
    for (const p of changed) {
      const abs = `${tree}/${p}`;
      const st = deps.fs.stat(abs);
      if (!st?.isFile) continue;
      const now = dec.decode(await deps.fs.read(abs));
      if (now !== files[p]) out[p] = now;
    }
    return { results, files: out };
  } finally {
    await deps.safeWrite.remove(deps.home, rel, "home").catch(() => {});
  }
}
