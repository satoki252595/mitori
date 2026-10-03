import { type ExecMode, type RepoPath, SENSITIVE_GLOBS } from "@mitori/core";
import { pathMatcher } from "./deny.ts";

/**
 * `Job.sensitive` (SEC-12): true for every agent-mode job and for any job whose write scope touches a
 * {@link SENSITIVE_GLOBS} file (package manifests, build scripts, agent-instruction files, …). A sensitive job has
 * no one-key accept: each file needs an explicit hunk decision in Review. Deterministic, from the scope alone.
 */
export function isSensitiveJob(mode: ExecMode, writeScope: readonly RepoPath[]): boolean {
  if (mode === "agent") return true;
  const hit = pathMatcher(SENSITIVE_GLOBS);
  return writeScope.some((p) => hit(p));
}
