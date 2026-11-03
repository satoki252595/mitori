import { type EngineSettings, MitoriError } from "@mitori/core";
import { scrubEnv } from "../claude/env.ts";
import { CLAUDE_MODE_DEFAULTS, type EngineRequest, type SpawnSpec } from "../contract.ts";

/**
 * Every flag `buildGrokSpawn` passes (the follow capability gate checks `grok --help` for all of them).
 * `-m` is the short form of the model flag; the gate accepts either spelling.
 */
export const GROK_REQUIRED_FLAGS = [
  "--prompt-file",
  "--output-format",
  "--reasoning-effort",
  "--max-turns",
  "--no-subagents",
  "--no-plan",
  "--disable-web-search",
  "--tools",
  "--disallowed-tools",
  "--cwd",
  "--verbatim",
  "--leader-socket",
  "--json-schema",
] as const;

/** True when `grok --help` documents every flag mitori passes (plus `-m` / `--model` for the model). */
export function grokCapabilityOk(help: string): boolean {
  if (!GROK_REQUIRED_FLAGS.every((f) => help.includes(f))) return false;
  return help.includes("--model") || /(?:^|\s)-m[\s,=:]/m.test(help);
}

/**
 * Built-in tools removed from every grok turn (`--disallowed-tools`, comma-separated).
 * Exactly the 22 names grok 1.0.70 reports in `available_commands` on the host
 * (2026-11-03, WP36e) plus the plan-mode pair, which stays together: grok refuses
 * session creation when only one side is denied (`exit_plan_mode` without
 * `enter_plan_mode`, WP36d). Stale names are gone: unknown entries only warn on
 * stderr (`no tool, so they remove nothing`) and remove nothing, so the old
 * over-enumerated list left `write` in place while warning about 8 phantom names.
 * `--tools ""` empties the toolset first; the denylist stays as a second bar.
 */
/**
 * The per-turn isolated `config.toml` (WP36f): `--tools ""` + `--disallowed-tools` + `--disable-web-search`
 * do NOT stop the server-side (backend) tools — host-measured grok 1.0.70 still ran `X search` three times
 * (`tool_call` with `variant: XSearch, backend: true`) on the same 34 KB prompt while `available_commands`
 * stayed `[]`, leaking the repo name to the external search. Only this file content stopped it (same argv and
 * prompt: 3 tool_calls → 0, 197 s → 86 s, usage in 8,643 / cache read 2,048 / out 5,167 / reasoning 1,217).
 * Key source: `~/.grok/docs/user-guide/26-config-reference.md` (`features.backend_tools`: "Enable or disable
 * backend_tools. Default true. Also GROK_BACKEND_SEARCH." — every key below is from that `features` table).
 * Why flags are not enough: `~/.grok/docs/user-guide/14-headless-mode.md:54` — the name `XSearch` only takes
 * effect on the daemon route, so no CLI flag list reaches the backend tool. Written byte-exact by the bridge
 * (`prepareConfig`) and the live test; tested in `grok-policy.test.ts`.
 */
export const GROK_ISOLATED_CONFIG_TOML = `disable_web_search = true

[features]
backend_tools = false
session_search = false
write_file = false
web_fetch = false
image_gen = false
video_gen = false
ask_user_question = false
feedback = false
telemetry = "off"
campaigns = false
codebase_indexing = false
session_recap = false
turn_summary = false
title_refresh = false
auto_wake = false
`;

export const GROK_DENIED_TOOLS = [
  "run_terminal_command",
  "read_file",
  "search_replace",
  "list_dir",
  "grep",
  "kill_command_or_subagent",
  "todo_write",
  "get_command_or_subagent_output",
  "scheduler_create",
  "scheduler_delete",
  "scheduler_list",
  "monitor",
  "search_tool",
  "use_tool",
  "workflow",
  "ask_user_question",
  "send_feedback",
  "image_gen",
  "image_edit",
  "image_to_video",
  "reference_to_video",
  "write",
  "enter_plan_mode",
  "exit_plan_mode",
] as const;

/** "You are not authenticated." (and siblings) without ever calling an LLM. */
export const GROK_UNAUTHENTICATED_RE = /not authenticated|not logged in|no auth|sign in/i;

/** One folded grok turn (`--output-format streaming-json`, one event per line). */
export interface GrokTurn {
  /** Accumulated `text` deltas. */
  text: string;
  /** Terminal usage when the output carried it (else the caller byte-estimates). */
  usage: { in: number; cacheRead: number; cacheWrite: number; out: number; thinking: number } | null;
  /** Tools named by a non-empty `available_commands` event: a newer grok than mitori knows. */
  unknownTools: string[] | null;
  /** First tool event seen (`<type>:<name>`), if the turn executed a tool. */
  toolCall: string | null;
  /** Error object carried by the stream, if any. */
  streamError: string | null;
  /** True once the terminal record arrived (`end` event or the single json object). */
  ended: boolean;
  /** Terminal `stopReason` (e.g. `end_turn`). */
  stopReason: string | null;
  /** Terminal `num_turns` (null when the output did not carry it). */
  turns: number | null;
  /** Terminal `total_cost_usd` (null when absent; ledger reference only, never the displayed price). */
  reportedUsd: number | null;
}

/** Empty fold state. */
export const emptyGrokTurn = (): GrokTurn => ({
  text: "",
  usage: null,
  unknownTools: null,
  toolCall: null,
  streamError: null,
  ended: false,
  stopReason: null,
  turns: null,
  reportedUsd: null,
});

const safeInt = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

/** Token usage carried by a `usage` event (null when absent). */
function grokUsageOf(raw: unknown): GrokTurn["usage"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;
  const input = safeInt(u.input_tokens);
  const output = safeInt(u.output_tokens);
  if (input === null || output === null) throw new MitoriError("E_AGENT_PROTOCOL", "grok usage event is invalid");
  // streaming-json reports the uncached input and the cache read side by side (host: 661 + 3200);
  // the fixed call cost is their sum (WP36e).
  return {
    in: input,
    cacheRead: safeInt(u.cache_read_input_tokens) ?? 0,
    cacheWrite: safeInt(u.cache_creation_input_tokens) ?? 0,
    out: output,
    thinking: safeInt(u.reasoning_tokens) ?? 0,
  };
}

/**
 * Fold one grok stdout line into the turn. `available_commands` names the tools the turn may
 * use: a non-empty list means a newer grok than mitori knows (`unknownTools`, fail-closed).
 * `text` deltas accumulate, `thought` is ignored, `usage` carries input/cache_read/cache_creation/
 * output/reasoning (reasoning is thinking), and `end` closes the turn (`end_turn` is normal).
 * ANY tool or permission event (`tool_call`, `permission_required`, `tool_use` blocks, …) is
 * recorded — the caller fails the turn when `toolCall` is set. Other unknown events are ignored
 * so a newer CLI cannot break the parser; non-JSON stdout lines are a protocol violation
 * (headless logs go to stderr).
 * `--output-format streaming-json` emits one event per line; `--output-format json`
 * pretty-prints several lines and is unreadable here.
 */
export function grokFoldLine(state: GrokTurn, line: string): GrokTurn {
  if (!line.trim()) return state;
  let obj: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(line);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    obj = v as Record<string, unknown>;
  } catch {
    throw new MitoriError("E_AGENT_PROTOCOL", "grok stdout is not streaming-json");
  }
  const type = typeof obj.type === "string" ? obj.type : null;
  if (type === null) throw new MitoriError("E_AGENT_PROTOCOL", "grok stdout line has no type");
  if (type === "available_commands") {
    if (!Array.isArray(obj.tools) || !obj.tools.every((t) => typeof t === "string"))
      throw new MitoriError("E_AGENT_PROTOCOL", "grok available_commands event is invalid");
    const tools = obj.tools as string[];
    if (tools.length === 0) return state;
    const seen = new Set(state.unknownTools ?? []);
    for (const t of tools.slice(0, 32)) seen.add(t.slice(0, 120));
    return { ...state, unknownTools: [...seen] };
  }
  if (type === "text" && typeof obj.data === "string") return { ...state, text: state.text + (obj.data as string) };
  if (type === "thought" || type === "progress" || type === "system" || type === "session") return state;
  if (type === "usage" && obj.usage && typeof obj.usage === "object") {
    return { ...state, usage: grokUsageOf(obj.usage) };
  }
  if (type === "end") {
    let next: GrokTurn = { ...state, ended: true, stopReason: typeof obj.stopReason === "string" ? (obj.stopReason as string) : null };
    const turns = safeInt(obj.num_turns);
    if (turns !== null) next = { ...next, turns };
    if (obj.usage && typeof obj.usage === "object") next = { ...grokFoldLine(next, JSON.stringify({ type: "usage", usage: obj.usage })), ended: true };
    return next;
  }
  if (type === "error") {
    const message =
      typeof obj.message === "string"
        ? obj.message
        : typeof (obj as { error?: { message?: unknown } }).error?.message === "string"
          ? ((obj as { error?: { message?: string } }).error?.message as string)
          : "grok failed";
    return { ...state, streamError: message.slice(0, 500) };
  }
  // Any tool-shaped or permission-shaped event means the turn executed a tool: fail it (tool
  // names travel in several fields).
  if (type.toLowerCase().includes("tool") || type.toLowerCase().includes("permission")) {
    const detail = typeof obj.toolName === "string" ? (obj.toolName as string) : typeof obj.name === "string" ? (obj.name as string) : type;
    return { ...state, toolCall: state.toolCall ?? `${type}:${detail}`.slice(0, 160) };
  }
  // Message-shaped events (`streaming-messages-json` / ACP transcripts): a `tool_use` or `tool_result`
  // block inside the content means a tool ran, whatever the envelope type is.
  for (const content of [obj.content, (obj.message as { content?: unknown } | undefined)?.content]) {
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const t = (block as { type?: unknown } | null)?.type;
      if (typeof t === "string" && (t.includes("tool_use") || t.includes("tool_result"))) {
        const name = (block as { name?: unknown })?.name;
        return { ...state, toolCall: state.toolCall ?? `${type}:${typeof name === "string" ? name : t}`.slice(0, 160) };
      }
    }
  }
  return state;
}

/** API-equivalent prices for one Grok model id: per-model entry first, then the engine `pricing`. */
export function grokPricing(settings: EngineSettings["grok-cli"], modelId: string): NonNullable<EngineSettings["grok-cli"]["pricing"]> | undefined {
  return settings.pricingByModel?.[modelId] ?? settings.pricing;
}

/** Paths the grok spawn needs (all absolute). */
export interface GrokSpawnPaths {
  /** Resolved absolute path of the user's unmodified `grok`. */
  grokBinary: string;
  /** Complete prompt (system + bundle + contract text) in a content-addressed file. */
  promptFile: string;
  /** `~/.mitori/run/empty` (verified empty before spawn). */
  emptyCwd: string;
  /** Isolated `GROK_HOME` root for this turn (auth copy, sessions, leader socket). */
  configRoot: string;
}

/**
 * Single-turn text-only `grok` spawn: `--prompt-file` (stdin empty), `--output-format
 * streaming-json` (one event per line: `available_commands`, `thought`, `text`, `usage`, `end`),
 * `-m`, `--reasoning-effort`, `--max-turns 1`, `--no-subagents`, `--no-plan`,
 * `--disable-web-search`, `--tools ""` plus every built-in tool denied, `--cwd` the empty
 * sandbox, `--verbatim`, and the leader socket inside the isolated root (no `--always-approve`,
 * no permission-mode bypass). Never `--resume`/`-c`: each turn starts fresh and the isolated
 * root is deleted afterwards.
 */
export function buildGrokSpawn(
  req: EngineRequest,
  settings: EngineSettings["grok-cli"],
  paths: GrokSpawnPaths,
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  if (!paths.grokBinary.startsWith("/")) throw new MitoriError("E_INVALID_INPUT", "grok binary must be a resolved absolute path");
  if (!paths.promptFile.startsWith("/")) throw new MitoriError("E_PRECONDITION", "grok prompt needs a secure absolute prompt file");
  if (!paths.emptyCwd.startsWith("/")) throw new MitoriError("E_PRECONDITION", "grok needs a secure absolute empty cwd");
  if (!paths.configRoot.startsWith("/")) throw new MitoriError("E_PRECONDITION", "grok needs an isolated GROK_HOME root");
  if (req.mode === "agent" || req.mode === "patch") throw new MitoriError("E_UNSUPPORTED", "the grok engine has no agent or patch mode (text-only)");
  if (req.tools !== "none") throw new MitoriError("E_UNSUPPORTED", "the grok engine only accepts text-only requests");
  const model = req.model.startsWith("grok:") ? req.model.slice("grok:".length) : settings.model;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model)) throw new MitoriError("E_INVALID_INPUT", "grok requests must name an exact grok:<model> id");
  const argv = [
    "--prompt-file",
    paths.promptFile,
    "--output-format",
    "streaming-json",
    "-m",
    model,
    "--reasoning-effort",
    req.effort,
    "--max-turns",
    "1",
    "--no-subagents",
    "--no-plan",
    "--disable-web-search",
    "--tools",
    "",
    "--disallowed-tools",
    GROK_DENIED_TOOLS.join(","),
    "--cwd",
    paths.emptyCwd,
    "--verbatim",
    "--leader-socket",
    `${paths.configRoot.replace(/\/+$/, "")}/leader.sock`,
    ...(req.jsonSchema ? ["--json-schema", JSON.stringify(req.jsonSchema)] : []),
  ];
  const env = scrubEnv(parentEnv, []);
  // The isolated home carries the auth copy; the real HOME (hooks, MCP, memory, rules) is unreachable.
  env.HOME = paths.configRoot;
  env.GROK_HOME = paths.configRoot;
  // XAI_API_KEY is never passed: it would switch the turn from the login subscription to metered API
  // billing. API users take the HTTP path (`setup grok --api`) instead.
  return {
    command: paths.grokBinary,
    argv,
    env,
    cwd: paths.emptyCwd,
    stdin: "",
    keepStdinOpen: false,
    timeoutMs: req.budget.ms > 0 ? req.budget.ms : (settings.turnMs ?? CLAUDE_MODE_DEFAULTS[req.mode].turnMs),
    processGroup: true,
  };
}
