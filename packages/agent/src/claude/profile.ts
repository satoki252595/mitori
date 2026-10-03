import { type ClaudeModelId, canonicalJson, type Hasher, type Xxh3 } from "@mitori/core";
import type { EngineRequest, WarmProfile } from "../contract.ts";
import { injectedEnv } from "./env.ts";

/** Modes a warm process may serve (cwd = empty sandbox, byte-stable system prompt; spec §6.6.1). */
export const WARM_MODES: ReadonlySet<EngineRequest["mode"]> = new Set(["answer", "findings", "patch"]);

/**
 * The warm profile of a request [CONS-32]. The per-job `--max-budget-usd` is not part of it; the ENV_INJECT values are
 * (`envHash`) [PT-02]. `systemHash` is the xxh3 of the system prompt file content.
 */
export function warmProfileOf(req: EngineRequest, hasher: Hasher, persistSessions: boolean): WarmProfile | null {
  if (!WARM_MODES.has(req.mode) || req.tools !== "none") return null;
  const env = injectedEnv(req.mode, { maxOutTokens: req.budget.outTokens, persistSessions });
  return {
    engine: "claude-cli",
    mode: req.mode as WarmProfile["mode"],
    model: req.model as ClaudeModelId,
    effort: req.effort,
    systemHash: hasher.xxh3(req.system),
    schemaHash: req.jsonSchema === undefined ? null : hasher.xxh3(canonicalJson(req.jsonSchema)),
    envHash: hasher.xxh3(canonicalJson(env)),
  };
}

/** Profile key = xxh3(binary realpath + version + canonical profile). */
export function warmProfileKey(profile: WarmProfile, binary: { realpath: string; version: string }, hasher: Hasher): Xxh3 {
  return hasher.xxh3(`${binary.realpath}\n${binary.version}\n${canonicalJson(profile)}`);
}
