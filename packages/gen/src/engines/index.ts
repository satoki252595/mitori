/**
 * @mitori/gen — `engines/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { codexPreflight, type ScheduledRequest } from "@mitori/agent";
import { type EngineSettings, type GenEngineId, MitoriError, type WorkspaceKey } from "@mitori/core";
import type { GenCall } from "../contract.ts";

/**
 * Map a call to the scheduler request (pure; golden-tested against §8.2/§8.3).
 * claude-cli: `mode: "generate"`, `system` = layout.system + "\n" + layout.pack (the agent package writes it to a
 * content-addressed `--system-prompt-file`), `prompt` = layout.shared? + layout.unit, tools "none", cwd = sandbox,
 * `keepAlive: true` (continuation retry, §6.4), `persistSession: false`, `promptVer` = spec.version.
 * Cold retry: the retry block goes as a second content block (`promptBlocks`, §17 L2).
 * anthropic-api: `apiLayout` carries BP1 (system) / BP2 (pack) with the call TTL and BP3 (shared, 5m); `fallbacks: "default"`.
 */
export function toScheduledRequest(
  call: GenCall,
  ctx: { ws: WorkspaceKey; sandboxCwd: string; engine: Exclude<GenEngineId, "session">; codex?: EngineSettings["codex-cli"] },
): ScheduledRequest {
  const { layout } = call;
  const api = ctx.engine === "anthropic-api";
  // anthropic-api sends the shared DATA as its own BP3 content block (apiLayout.shared); claude-cli inlines it
  const prompt = layout.shared === null || api ? layout.unit : `${layout.shared}\n${layout.unit}`;
  const req: ScheduledRequest = {
    ref: call.task,
    mode: "generate",
    cwd: ctx.sandboxCwd,
    model: call.model,
    effort: call.effort,
    tools: "none",
    writeScope: [],
    system: layout.pack === null ? layout.system : `${layout.system}\n${layout.pack}`,
    promptVer: call.spec.version,
    prompt,
    contract: "gen.block/1",
    keepAlive: ctx.engine !== "generic" && ctx.engine !== "codex-cli",
    persistSession: false,
    budget: { usd: call.budgetUsd, inTokens: Math.ceil(3 * call.estimate.in), outTokens: call.maxOutTokens, ms: call.timeoutMs },
    engine: ctx.engine,
    lane: call.lane,
    ws: ctx.ws,
    scope: { kind: "gen_task", id: call.task },
    estimate: call.estimate,
    fanoutKey: call.fanoutKey,
  };
  if (call.attempt === 2 && layout.retry !== null) req.promptBlocks = [prompt, layout.retry];
  if (call.jsonSchema) req.jsonSchema = call.jsonSchema;
  if (ctx.engine === "codex-cli") {
    const cfg = ctx.codex;
    if (!cfg?.pricing || !(cfg.maxEstimatedSpendUsd && Number.isFinite(cfg.maxEstimatedSpendUsd)))
      throw new MitoriError("E_CFG_INVALID", "Codex generation needs explicit pricing and estimated spend consent");
    // Match the native adapter's one-byte/token preflight, including a cold retry's complete prompt.
    const preflight = codexPreflight({ ...req, outTokens: call.maxOutTokens }, cfg.pricing);
    req.budget.inTokens = preflight.inTokens;
    req.budget.usd = Math.max(call.budgetUsd, preflight.usd);
    if (req.budget.usd > cfg.maxEstimatedSpendUsd)
      throw new MitoriError("E_BUDGET_EXCEEDED", "Codex generation conservative preflight exceeds the configured estimated spend consent");
  }
  if (api) {
    const system = [{ text: layout.system, ttl: call.ttl }];
    if (layout.pack !== null) system.push({ text: layout.pack, ttl: call.ttl });
    req.apiLayout = layout.shared === null ? { system } : { system, shared: { text: layout.shared, ttl: "5m" } };
    req.fallbacks = "default";
  }
  return req;
}
