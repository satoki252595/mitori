/**
 * @mitori/loop — `pull/` (owner: WP-11). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { labelFromEnv, pathsOfHook } from "./hook.ts";

/** Extract absolute paths from a hook payload (≤ 1 MiB stdin). Never throws. */
export function parseTouchHook(stdin: string): string[] {
  return pathsOfHook(stdin);
}

/** Agent label for `x-mitori-agent`: `--agent` > MITORI_AGENT > CLAUDECODE=1 ⇒ claude-code > CODEX_* ⇒ codex > "pull". */
export function agentLabelFromEnv(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): string {
  return labelFromEnv(flag, env);
}
