import { type EngineSettings, MitoriError, parseRepoPath, priceUsage } from "@mitori/core";
import type { EngineRequest } from "../contract.ts";

/** Profile verified with the native binary and a local Responses server (no paid model). */
export const CODEX_VERSION = "0.160.0";

/** Shared conservative estimate; native thinking has no hard token cap. Every tool step re-sends the context. */
export function codexPreflight(
  req: Pick<EngineRequest, "model" | "system" | "prompt" | "promptBlocks" | "jsonSchema"> & { outTokens: number; maxCalls?: number },
  pricing: NonNullable<EngineSettings["codex-cli"]["pricing"]>,
): { inTokens: number; usd: number } {
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  const inTokens = bytes(req.system) + bytes((req.promptBlocks ?? [req.prompt]).join("\n\n")) + bytes(JSON.stringify(req.jsonSchema ?? {})) + 2048;
  const usd = priceUsage(
    req.model,
    { in: (inTokens + req.outTokens) * ((req.maxCalls ?? 0) + 1), out: req.outTokens, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    false,
    pricing,
  );
  return { inTokens, usd };
}
export const CODEX_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "plugins",
  "hooks",
  "apps",
  "multi_agent",
  "multi_agent_v2",
  "browser_use",
  "computer_use",
  "image_generation",
  "request_permissions_tool",
  "skill_mcp_dependency_install",
  "memories",
  "goals",
  "view_image",
  "sleep_tool",
  "code_mode",
  "code_mode_host",
  "workspace_dependencies",
  "skill_search",
] as const;

/** Trusted metadata controls the native tool inventory; model server metadata cannot add tools. */
export function codexCatalog(model: string, agent: boolean): string {
  return JSON.stringify({
    models: [
      {
        slug: model,
        display_name: model,
        description: "mitori isolated engine",
        priority: 1,
        visibility: "list",
        default_reasoning_level: "low",
        supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({ effort, description: effort })),
        shell_type: "disabled",
        apply_patch_tool_type: agent ? "freeform" : null,
        web_search_tool_type: "text_and_image",
        tool_mode: "function",
        multi_agent_version: "disabled",
        multi_agent_reasoning_effort: "high",
        use_responses_lite: false,
        include_skills_usage_instructions: false,
        include_apps_usage_instructions: false,
        include_plugin_usage_instructions: false,
        prefer_websockets: false,
        support_verbosity: false,
        default_verbosity: "low",
        default_reasoning_summary: "none",
        input_modalities: ["text"],
        supports_image_detail_original: false,
        supports_parallel_tool_calls: false,
        truncation_policy: { mode: "tokens", limit: 10000 },
        context_window: 128000,
        max_context_window: 128000,
        auto_compact_token_limit: null,
        comp_hash: "mitori-lean-v1",
        guardian: null,
        node_repl_auto_review_required: true,
        node_repl_disabled: true,
        requires_sandboxed_review: false,
        auto_review_model_override: null,
        model_specialty: null,
        minimal_client_version: CODEX_VERSION,
        supported_in_api: true,
        availability_nux: null,
        upgrade: null,
        model_messages: { instructions_template: "Use only the supplied context. Return the requested contract." },
        experimental_supported_tools: [],
        available_in_plans: [],
        supports_search_tool: false,
        supports_experimental_context: false,
        default_service_tier: null,
        service_tiers: [],
        additional_speed_tiers: [],
        supports_reasoning_summary_parameter: false,
        supports_reasoning_summaries: false,
        supports_reasoning_effort_updates: false,
      },
    ],
  });
}

export function codexFilesystem(req: EngineRequest, binary: string, cwd: string): string {
  if (!cwd.startsWith("/") || !binary.startsWith("/")) throw new MitoriError("E_INVALID_INPUT", "Codex paths must be absolute");
  const entries = new Map<string, string>([
    [":minimal", "read"],
    [binary, "read"],
    [cwd, "read"],
  ]);
  if (req.mode === "agent") {
    if (req.tools !== "read_edit" || req.writeScope.length === 0) throw new MitoriError("E_INVALID_INPUT", "Codex agent needs an exact nonempty write scope");
    if ((req.newFiles ?? []).some((path) => !req.writeScope.includes(path))) throw new MitoriError("E_INVALID_INPUT", "Codex newFiles must stay in writeScope");
    for (const path of req.writeScope) {
      if (!parseRepoPath(path).ok) throw new MitoriError("E_INVALID_INPUT", "Codex write scope contains an unsafe path");
      entries.set(`${cwd.replace(/\/+$/, "")}/${path}`, "write");
    }
  } else if (req.tools !== "none") throw new MitoriError("E_INVALID_INPUT", "Codex text requests cannot enable tools");
  return `{${[...entries].map(([path, mode]) => `${JSON.stringify(path)}=${JSON.stringify(mode)}`).join(",")}}`;
}
