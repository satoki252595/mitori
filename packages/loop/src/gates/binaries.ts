// F9 (nonfunc audit): what a repo-local formatter binary IS, for the gate trust hash. `node_modules/.bin/biome` is a
// Node launcher that spawns `@biomejs/cli-<os>-<arch>/biome`; `.venv/bin/black` is a Python console script that
// imports site-packages. Trusting "biome format --write" once used to cover whatever `npm install` put there later.
// The digest is sha256 over the realpath and the bytes; it is cached per (realpath, size, mtime, ctime, inode), so
// planning hashes a 40 MB native formatter once, not on every estimate.
import type { FsReader, Hasher, RepoPath } from "@mitori/core";
import { GATE_LOCAL_BINARIES } from "../contract.ts";
import { ancestors, dirOf, join } from "./detect.ts";

/** Identity of one binary. */
export interface BinaryInfo {
  digest: string;
  /** Starts with `#!`. */
  script: boolean;
}

const CACHE = new Map<string, BinaryInfo>();
const CACHE_MAX = 256;

/** The repo-local binaries detection may use for `changed` (each manifest-candidate directory). */
export function localBinaryCandidates(fs: Pick<FsReader, "readdir">, root: string, changed: readonly RepoPath[]): string[] {
  const out = new Set<string>();
  for (const p of changed)
    for (const d of ancestors(dirOf(p))) {
      for (const rel of GATE_LOCAL_BINARIES) out.add(`${root}/${join(d, rel)}`);
      const scope = `${root}/${join(d, "node_modules/@biomejs")}`;
      for (const n of fs.readdir(scope) ?? []) if (n.startsWith("cli-")) out.add(`${scope}/${n}/biome`);
    }
  return [...out].sort();
}

/** Digest + launcher flag of each existing candidate (missing ones are absent). */
export async function binaryInfos(fs: FsReader, hasher: Pick<Hasher, "sha256">, abs: readonly string[]): Promise<Map<string, BinaryInfo>> {
  const out = new Map<string, BinaryInfo>();
  for (const a of abs) {
    const real = fs.realpath(a);
    const st = real ? fs.stat(real) : null;
    if (!real || !st?.isFile) continue;
    const key = `${real}\0${st.size}\0${st.mtimeNs}\0${st.ctimeNs ?? 0n}\0${st.ino}`;
    let info = CACHE.get(key);
    if (!info) {
      const bytes = await fs.read(real);
      info = { digest: hasher.sha256(`${real}\0${hasher.sha256(bytes)}`), script: bytes[0] === 0x23 && bytes[1] === 0x21 };
      if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
      CACHE.set(key, info);
    }
    out.set(a, info);
  }
  return out;
}
