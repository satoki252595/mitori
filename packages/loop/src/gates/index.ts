/**
 * @mitori/loop — `gates/` (owner: WP-08b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";

/** Build a ≤ 1k-token, secret-redacted failure excerpt from gate output. */
export function gateExcerpt(output: string, ctx: { worktree: string; estimateTokens(text: string): number }): string {
  return unsupported("loop.gateExcerpt", output, ctx);
}
