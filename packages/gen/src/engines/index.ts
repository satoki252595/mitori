/**
 * @mitori/gen — `engines/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import type { ScheduledRequest } from "@mitori/agent";
import { type GenEngineId, unsupported, type WorkspaceKey } from "@mitori/core";
import type { GenCall } from "../contract.ts";

/**
 * Map a call to the scheduler request (pure; golden-tested against §8.2/§8.3).
 * claude-cli: `mode: "generate"`, `system` = layout.system + "\n" + layout.pack (the agent package writes it to a
 * content-addressed `--system-prompt-file`), `prompt` = layout.shared? + layout.unit, tools "none", cwd = sandbox,
 * `keepAlive: true` (continuation retry, §6.4), `persistSession: false`, `promptVer` = spec.version.
 * Cold retry: the retry block goes as a second content block once `EngineRequest.promptBlocks` exists (§17 L2).
 */
export function toScheduledRequest(call: GenCall, ctx: { ws: WorkspaceKey; sandboxCwd: string; engine: Exclude<GenEngineId, "session"> }): ScheduledRequest {
  return unsupported("gen.toScheduledRequest", call, ctx);
}
