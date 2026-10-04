// The pinned corpus for the perf specs (bench/corpus.lock.json → ~/.cache/mitori-corpus/<name>@<sha12>, or
// MITORI_CORPUS_DIR): a scratch COPY per test, because opening a repository writes its `.mitori/` doc into it.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./ui.ts";

interface LockEntry {
  name: string;
  commit: string | null;
  tag?: string;
}

/** Path of a fetched corpus clone, or null (the spec then skips: `bun run corpus:fetch --only <name>`). */
export function corpusDir(name: string): string | null {
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, "bench/corpus.lock.json"), "utf8")) as { repos: LockEntry[] };
  const e = lock.repos.find((r) => r.name === name);
  if (!e) return null;
  const dir = join(
    process.env.MITORI_CORPUS_DIR ?? join(homedir(), ".cache", "mitori-corpus"),
    `${e.name}@${e.commit ? e.commit.slice(0, 12) : (e.tag ?? "unpinned")}`,
  );
  return existsSync(dir) ? dir : null;
}

/** A scratch copy of a corpus repository. */
export function corpusCopy(name: string): { root: string; dispose(): void } {
  const src = corpusDir(name);
  if (!src) throw new Error(`corpus ${name} is not fetched (bun run corpus:fetch --only ${name})`);
  const dir = mkdtempSync(join(tmpdir(), `mitori-perf-${name}-`));
  const root = join(dir, name);
  cpSync(src, root, { recursive: true, verbatimSymlinks: true });
  return { root, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
