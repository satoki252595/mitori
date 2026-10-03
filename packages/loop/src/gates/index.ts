/**
 * @mitori/loop — `gates/` (owner: WP-08b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files (detect.ts, expand.ts, runner.ts, sandbox.ts).
 */
import { excerpt } from "./excerpt.ts";

/** Build a ≤ 1k-token, secret-redacted failure excerpt from gate output. */
export function gateExcerpt(output: string, ctx: { worktree: string; estimateTokens(text: string): number }): string {
  return excerpt(output, ctx);
}
