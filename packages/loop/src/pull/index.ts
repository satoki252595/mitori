/**
 * @mitori/loop — `pull/` (owner: WP-11). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";

/** Extract absolute paths from a hook payload (≤ 1 MiB stdin). Never throws. */
export function parseTouchHook(stdin: string): string[] {
  return unsupported("loop.parseTouchHook", stdin);
}

/** Agent label for `x-mitori-agent`: `--agent` > MITORI_AGENT > CLAUDECODE=1 ⇒ claude-code > CODEX_* ⇒ codex > "pull". */
export function agentLabelFromEnv(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): string {
  return unsupported("loop.agentLabelFromEnv", flag, env);
}
