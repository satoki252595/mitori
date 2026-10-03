// Locates the pinned corpus clones (bench/corpus.lock.json; `bun run corpus:fetch` fills ~/.cache/mitori-corpus).
// Tests and benches that need a corpus skip when it is absent.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./env.ts";

interface LockEntry {
  name: string;
  commit: string | null;
  tag?: string;
  subdir?: string;
}

const lock = JSON.parse(readFileSync(join(REPO_ROOT, "bench/corpus.lock.json"), "utf8")) as { repos: LockEntry[] };

/** Absolute root of a corpus checkout (with `subdir` applied), or null when it is not available locally. */
export function corpusDir(name: string): string | null {
  const e = lock.repos.find((r) => r.name === name);
  const roots = [process.env.MITORI_CORPUS_DIR, join(homedir(), ".cache", "mitori-corpus")].filter((x): x is string => typeof x === "string");
  if (e !== undefined) {
    const id = `${e.name}@${e.commit !== null ? e.commit.slice(0, 12) : (e.tag ?? "unpinned")}`;
    for (const r of roots) {
      const d = join(r, id, e.subdir ?? "");
      if (existsSync(d)) return d;
    }
  }
  for (const from of (process.env.MITORI_CORPUS_FROM ?? "").split(",").filter(Boolean)) {
    const d = join(from, name);
    if (existsSync(d)) return d;
  }
  if (name === "gostd") {
    // The lock pins go1.27.1's src/; a host toolchain of that version is the same tree.
    for (const d of ["/opt/homebrew/Cellar/go/1.27.1/libexec/src", "/usr/local/go/src"]) {
      if (existsSync(join(d, "../VERSION")) && readFileSync(join(d, "../VERSION"), "utf8").startsWith("go1.27.1")) return d;
    }
  }
  return null;
}
