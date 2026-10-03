import type { Glob, RepoPath } from "@mitori/core";
import picomatch from "picomatch";

const cache = new Map<string, (path: string) => boolean>();
const CACHE_MAX = 16;

/**
 * Matcher for a deny/sensitive glob list: picomatch `{ dot: true }`, the semantics core pins in CORE-U-007 (`.envrc`
 * and every `.env.*` are denied, dot-directories are reached). Compiled once per distinct list.
 */
export function pathMatcher(globs: readonly Glob[]): (path: RepoPath) => boolean {
  if (globs.length === 0) return () => false;
  const key = globs.join("\u0000");
  let fn = cache.get(key);
  if (!fn) {
    fn = picomatch([...globs], { dot: true });
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, fn);
  }
  return fn;
}
