/**
 * @mitori/agent — `adapters/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type EngineSettings, type Result, unsupported } from "@mitori/core";
import type { AnthropicApiRequest, EngineRequest, SpawnSpec } from "../contract.ts";

/** codex-cli spawn builder (after MVP). Agent mode is not supported until a no-shell config is verified. */
export function buildCodexSpawn(
  req: EngineRequest,
  settings: EngineSettings["codex-cli"],
  paths: { codexBinary: string; schemaFile: string | null; lastMessageFile: string; emptyCwd: string },
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  return unsupported("agent.buildCodexSpawn", req, settings, paths, parentEnv);
}

/** generic adapter spawn (global `engines.generic.argv`; prompt = system + bundle + contract text on stdin). */
export function buildGenericSpawn(
  req: EngineRequest,
  settings: EngineSettings["generic"],
  paths: { emptyCwd: string },
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  return unsupported("agent.buildGenericSpawn", req, settings, paths, parentEnv);
}

/** Extract the contract JSON from free-form stdout (last ```json fence, else whole stdout). */
export function extractJsonFromText(stdout: string): Result<unknown> {
  return unsupported("agent.extractJsonFromText", stdout);
}

/** Build the anthropic-api request (answer/findings/patch only; agent mode routes to claude-cli). */
export function buildAnthropicRequest(req: EngineRequest): AnthropicApiRequest {
  return unsupported("agent.buildAnthropicRequest", req);
}
