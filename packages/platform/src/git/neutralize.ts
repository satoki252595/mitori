// SEC-05 for reads: `git status` runs `filter.<x>.clean` / `.process` on stat-dirty files, so a filter driver planted
// in the repository's own config (.git/config, config.worktree, or a file it includes) would execute on scan. Every
// read-only status call disables repo-local filter drivers with `-c` overrides (user/global config stays trusted).
// Reading raw worktree bytes is what the indexer wants anyway.

/** Parse `git config --list --show-scope -z` (`scope\0key\nvalue\0`…) into the local/worktree keys. */
export function localConfigKeys(raw: string): string[] {
  const parts = raw.split("\0");
  const keys: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i] as string;
    const kv = parts[i + 1] as string;
    if (scope !== "local" && scope !== "worktree") continue;
    const nl = kv.indexOf("\n");
    keys.push(nl >= 0 ? kv.slice(0, nl) : kv);
  }
  return keys;
}

const FILTER_KEY = /^filter\.(.+)\.(?:clean|smudge|process|required)$/i;

/** `-c` pairs that disable every filter driver named in `keys`. */
export function filterNeutralizers(keys: readonly string[]): string[] {
  const drivers = new Set<string>();
  for (const k of keys) {
    const m = FILTER_KEY.exec(k);
    if (m) drivers.add(m[1] as string);
  }
  const out: string[] = [];
  for (const d of [...drivers].sort())
    out.push("-c", `filter.${d}.clean=`, "-c", `filter.${d}.smudge=`, "-c", `filter.${d}.process=`, "-c", `filter.${d}.required=false`);
  return out;
}
