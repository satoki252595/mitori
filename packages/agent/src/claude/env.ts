import { ENV_ALLOWLIST, ENV_DENY_PREFIXES, ENV_DENYLIST, ENV_INJECT, type EngineMode } from "../contract.ts";

const ALLOW: ReadonlySet<string> = new Set(ENV_ALLOWLIST);
const DENY: ReadonlySet<string> = new Set(ENV_DENYLIST);

/** True when a variable may never reach a child (denylist or a denied prefix), even via passthrough. */
export function envDenied(name: string): boolean {
  return DENY.has(name) || ENV_DENY_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * I5: `ENV_ALLOWLIST ∩ parent (+ passthrough) − ENV_DENYLIST − MITORI_*`. Undefined values are dropped.
 * Passthrough is the global `envPassthrough` list only (repo settings cannot extend it).
 */
export function scrubEnv(parent: Readonly<Record<string, string | undefined>>, passthrough: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const wanted = new Set<string>([...ALLOW, ...passthrough]);
  for (const name of wanted) {
    if (envDenied(name)) continue;
    const v = parent[name];
    if (typeof v === "string") out[name] = v;
  }
  return out;
}

/**
 * ENV_INJECT values for one request [PT-02, PT-09]: mode values, `{maxOutTokens}` substituted (generate), and the
 * 1h cache TTL when sessions persist. These override inherited values and are part of the warm-profile key.
 */
export function injectedEnv(mode: EngineMode, opts: { maxOutTokens: number; persistSessions: boolean }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ENV_INJECT[mode])) out[k] = v.replace("{maxOutTokens}", String(Math.max(1, Math.floor(opts.maxOutTokens))));
  if (opts.persistSessions) Object.assign(out, ENV_INJECT.persistSessions);
  return out;
}
