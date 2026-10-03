import { type ClaudeModelId, canonicalJson, type Hasher, type Xxh3 } from "@mitori/core";
import type { EngineRequest, SpawnSpec, WarmProfile } from "../contract.ts";
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

/**
 * A warm process may serve a job only if it was launched exactly as the job would be (spec §6.6.1: binary, every argv
 * element but the prompt, the env): the profile key does not see settings such as `inheritUserSettings` or
 * `envPassthrough`, so a warm process spawned before a settings change must not serve a job after it. Only the
 * `--max-budget-usd` value (mode-floor backstop, CONS-32) and a freshly issued `--session-id` may differ.
 */
export function sameLaunch(warm: SpawnSpec, job: SpawnSpec): boolean {
  const masked: ReadonlySet<string> = new Set(["--max-budget-usd", "--session-id"]);
  const argv = (s: SpawnSpec) => s.argv.map((a, i) => (masked.has(s.argv[i - 1] ?? "") ? "*" : a));
  const env = (s: SpawnSpec) => canonicalJson(s.env);
  return warm.command === job.command && warm.cwd === job.cwd && canonicalJson(argv(warm)) === canonicalJson(argv(job)) && env(warm) === env(job);
}
