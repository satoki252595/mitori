// Repository-local git config, read once per workspace (SEC-05, ADR-0006 R1-4):
// - command-bearing keys (`GIT_COMMAND_CONFIG_PATTERNS`) in the user's local / worktree config (and the files they
//   include) become TrustRecord item `git_config`; until it is trusted every mitori call that loads the user's config
//   neutralizes them through `GIT_CONFIG_*` env (never `-c key=`: a driver named `a=b` would evade it);
// - side-repo calls (GIT_DIR = side.git) never load the user's config at all, so a small allowlist of conversion
//   settings is mirrored into them (otherwise `add` would hash with other eol / filemode rules than the user's git).
//   Once trusted, the command-bearing filter drivers are mirrored as well (the user's LFS filter keeps working).
import type { Hasher, Sha256 } from "@mitori/core";
import { GIT_COMMAND_CONFIG_PATTERNS } from "../contract.ts";
import type { ConfigPair } from "./exec.ts";

/** One `git config --list --show-scope -z` entry. */
export interface ConfigEntry {
  /** `local`, `worktree`, `global`, `system`, `command`. */
  scope: string;
  /** Key as git prints it (section and name lower-cased, subsection verbatim). */
  key: string;
  /** Value (`""` for a valueless boolean). */
  value: string;
}

/** Local conversion settings mirrored into side-repo calls (they change blob ids or modes, never run commands). */
export const MIRRORED_KEYS: ReadonlySet<string> = new Set([
  "core.autocrlf",
  "core.eol",
  "core.safecrlf",
  "core.filemode",
  "core.symlinks",
  "core.ignorecase",
  "core.precomposeunicode",
  "core.checkroundtripencoding",
  "core.bigfilethreshold",
]);

/** Parse `git config --list --show-scope -z` output (`scope\0key\nvalue\0`…). */
export function parseConfigList(raw: string): ConfigEntry[] {
  const parts = raw.split("\0");
  const out: ConfigEntry[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i] as string;
    const kv = parts[i + 1] as string;
    const nl = kv.indexOf("\n");
    out.push({ scope, key: nl >= 0 ? kv.slice(0, nl) : kv, value: nl >= 0 ? kv.slice(nl + 1) : "" });
  }
  return out;
}

/** True for a command-bearing key. */
export function isCommandKey(key: string): boolean {
  const k = key.toLowerCase();
  // the subsection keeps its case: match on the lower-cased key (patterns are lower-case)
  return GIT_COMMAND_CONFIG_PATTERNS.some((re) => re.test(k));
}

/** What the scan found. */
export interface RepoConfig {
  /** Command-bearing local / worktree entries, sorted (key, value). */
  commands: ConfigEntry[];
  /** `sha256` over the canonical command entries (TrustRecord `git_config`); null when there are none. */
  trustHash: Sha256 | null;
  /** Mirrored local conversion settings. */
  mirror: ConfigPair[];
}

const LOCAL = new Set(["local", "worktree"]);

/** Classify the user's config. */
export function scanConfig(entries: readonly ConfigEntry[], hasher: Pick<Hasher, "sha256">): RepoConfig {
  const commands = entries
    .filter((e) => LOCAL.has(e.scope) && isCommandKey(e.key))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const mirror: ConfigPair[] = [];
  const seen = new Map<string, number>();
  for (const e of entries) {
    if (!LOCAL.has(e.scope) || !MIRRORED_KEYS.has(e.key.toLowerCase())) continue;
    // last one wins, like git
    const at = seen.get(e.key.toLowerCase());
    if (at === undefined) {
      seen.set(e.key.toLowerCase(), mirror.length);
      mirror.push([e.key, e.value]);
    } else mirror[at] = [e.key, e.value];
  }
  const canonical = commands.map((e) => `${e.key}\n${e.value}\n`).join("");
  return { commands, trustHash: commands.length > 0 ? hasher.sha256(`mitori.git_config/1\n${canonical}`) : null, mirror };
}

const DRIVER_RE = /^(filter|merge|diff)\.(.+)\.([a-z]+)$/u;

/**
 * Overrides that disable every command-bearing key of `commands` for calls that load the user's config. Filter
 * drivers become no-ops (`required=false`), a merge driver becomes `false` (a conflict, never a silent "ours"),
 * a redirected hooks dir falls back to git's default `<commonDir>/hooks` (as if the key were unset), diff commands /
 * helpers / programs become empty.
 */
export function neutralizers(commands: readonly ConfigEntry[], opts: { defaultHooks: string }): ConfigPair[] {
  const out = new Map<string, string>();
  for (const e of commands) {
    const m = DRIVER_RE.exec(e.key);
    if (m && m[1] === "filter") {
      const d = m[2] as string;
      out.set(`filter.${d}.clean`, "");
      out.set(`filter.${d}.smudge`, "");
      out.set(`filter.${d}.process`, "");
      out.set(`filter.${d}.required`, "false");
    } else if (m && m[1] === "merge") out.set(e.key, "false");
    else if (e.key.toLowerCase() === "core.hookspath") out.set(e.key, opts.defaultHooks);
    else out.set(e.key, "");
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Trusted filter drivers mirrored into side-repo calls (so `add` cleans like the user's git does). */
export function trustedFilters(commands: readonly ConfigEntry[]): ConfigPair[] {
  return commands.filter((e) => e.key.startsWith("filter.")).map((e) => [e.key, e.value] as const);
}
