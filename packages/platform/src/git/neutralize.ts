// SEC-05 for reads: `git status` runs `filter.<x>.clean` / `.process` on stat-dirty files, so a filter driver planted
// in the repository's own config (.git/config, config.worktree, or a file it includes) would execute on scan. Every
// read-only status call disables repo-local filter drivers (user/global config stays trusted). Reading raw worktree
// bytes is what the indexer wants anyway.

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
const INCLUDE_KEY = /^include(?:if\..+)?\.path$/i;

/** True when the local config pulls in other files (their changes do not move `.git/config`'s mtime). */
export function hasIncludes(keys: readonly string[]): boolean {
  return keys.some((k) => INCLUDE_KEY.test(k));
}

/** Overrides that disable the filter drivers named in `keys`. */
export interface Neutralizers {
  /** `-c key=value` pairs (every git version; cannot express a driver name containing `=`). */
  args: string[];
  /**
   * The same overrides as `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` (git ≥ 2.31): key and value
   * travel separately, so a driver named `a=b` (which `-c` would split at its `=`) is disabled too.
   */
  env: Record<string, string>;
}

/** Overrides that disable every filter driver named in `keys`. */
export function filterNeutralizers(keys: readonly string[]): Neutralizers {
  const drivers = new Set<string>();
  for (const k of keys) {
    const m = FILTER_KEY.exec(k);
    if (m) drivers.add(m[1] as string);
  }
  const args: string[] = [];
  const env: Record<string, string> = {};
  let n = 0;
  for (const d of [...drivers].sort()) {
    const pairs: [string, string][] = [
      [`filter.${d}.clean`, ""],
      [`filter.${d}.smudge`, ""],
      [`filter.${d}.process`, ""],
      [`filter.${d}.required`, "false"],
    ];
    for (const [key, value] of pairs) {
      if (!d.includes("=")) args.push("-c", `${key}=${value}`);
      env[`GIT_CONFIG_KEY_${n}`] = key;
      env[`GIT_CONFIG_VALUE_${n}`] = value;
      n++;
    }
  }
  if (n > 0) env.GIT_CONFIG_COUNT = String(n);
  return { args, env };
}
