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
 * Shell-route ids first (`run_terminal_cmd`, `task`, …), then the display-name spellings the model
 * is shown (`run_terminal_command`, `spawn_subagent`, …), then daemon-route names (`StrReplace`,
 * `CallMcpTool`, …) so a renamed route still loses the tool. Unknown entries only warn on stderr
 * and remove nothing, so over-enumeration is safe.
 * `--tools ""` (accepted since the 1.0.70 host measurement, WP36b) empties the toolset first; the
 * denylist stays as a second bar so a renamed built-in cannot slip back in.
 */
export const GROK_DENIED_TOOLS = [
  "read_file",
  "search_replace",
  "grep",
  "list_dir",
  "run_terminal_cmd",
  "run_terminal_command",
  "bash",
  "web_search",
  "web_fetch",
  "todo_write",
  "task",
  "spawn_subagent",
  "kill_task",
  "kill_command_or_subagent",
  "get_task_output",
  "get_command_or_subagent_output",
  "wait_tasks",
  "wait_commands_or_subagents",
  "search_tool",
  "use_tool",
  "lsp",
  "enter_plan_mode",
  "workflow",
  "monitor",
  "execute",
  "StrReplace",
  "EditNotebook",
  "Delete",
  "Shell",
  "Await",
  "ReadLints",
  "SwitchMode",
  "AskQuestion",
  "CreatePlan",
  "CallMcpTool",
  "GetMcpTools",
  "FetchMcpResource",
  "ListMcpResources",
  "GenerateImage",
  "GenerateVideo",
  "CreateGoal",
  "UpdateGoal",
  "XSearch",
  "Read",
  "Grep",
  "Glob",
  "TodoWrite",
  "WebSearch",
  "WebFetch",
  "Write",
  "memory",
  "Agent",
] as const;

/** "You are not authenticated." (and siblings) without ever calling an LLM. */
export const GROK_UNAUTHENTICATED_RE = /not authenticated|not logged in|no auth|sign in/i;

/** One folded grok turn (`--output-format json`; `streaming-json` events stay tolerated). */
export interface GrokTurn {
  /** Accumulated `text` deltas. */
  text: string;
  /** Terminal usage when the output carried it (else the caller byte-estimates). */
  usage: { in: number; cacheRead: number; cacheWrite: number; out: number; thinking: number } | null;
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
  toolCall: null,
  streamError: null,
  ended: false,
  stopReason: null,
  turns: null,
  reportedUsd: null,
});

const safeInt = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

/** Token usage carried by a `usage` event or the single json object (null when absent). */
function grokUsageOf(raw: unknown): GrokTurn["usage"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;
  const input = safeInt(u.input_tokens);
  const output = safeInt(u.output_tokens);
  if (input === null || output === null) throw new MitoriError("E_AGENT_PROTOCOL", "grok usage event is invalid");
  const cached = safeInt(u.cache_read_input_tokens) ?? 0;
  if (cached > input) throw new MitoriError("E_AGENT_PROTOCOL", "grok cached input exceeds total input");
  return {
    in: input - cached,
    cacheRead: cached,
    cacheWrite: safeInt(u.cache_creation_input_tokens) ?? 0,
    out: output,
    thinking: safeInt(u.reasoning_tokens) ?? 0,
  };
}

/**
 * Fold one grok stdout line into the turn. `text` deltas accumulate, the terminal record carries
 * usage, and ANY tool event (`tool_call`, `tool_use`, …) is recorded — the caller fails the turn
 * when `toolCall` is set. Unknown non-tool events are ignored so a newer CLI cannot break the
 * parser; non-JSON stdout lines are a protocol violation (headless logs go to stderr).
 * `--output-format json` emits one `{text, stopReason, usage, num_turns, total_cost_usd, …}` object;
 * `streaming-json` events stay accepted line by line.
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
  if (type === null) {
    // Plain `--output-format json`: one terminal object with text, usage, turn count and cost.
    if (typeof obj.text === "string") {
      const turns = safeInt(obj.num_turns);
      const cost = obj.total_cost_usd;
      return {
        ...state,
        text: state.text + (obj.text as string),
        ended: true,
        stopReason: typeof obj.stopReason === "string" ? (obj.stopReason as string) : "end_turn",
        usage: grokUsageOf(obj.usage) ?? state.usage,
        turns: turns ?? state.turns,
        reportedUsd: typeof cost === "number" && cost >= 0 && Number.isFinite(cost) ? cost : state.reportedUsd,
      };
    }
    throw new MitoriError("E_AGENT_PROTOCOL", "grok stdout line has no type");
  }
  if (type === "text" && typeof obj.data === "string") return { ...state, text: state.text + (obj.data as string) };
  if (type === "thought" || type === "progress" || type === "system" || type === "session") return state;
  if (type === "usage" && obj.usage && typeof obj.usage === "object") {
    return { ...state, usage: grokUsageOf(obj.usage) };
  }
  if (type === "end") {
    let next: GrokTurn = { ...state, ended: true, stopReason: typeof obj.stopReason === "string" ? (obj.stopReason as string) : null };
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
  // Any tool-shaped event means the turn executed a tool: fail it (tool names travel in several fields).
  if (type.toLowerCase().includes("tool")) {
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
 * Single-turn text-only `grok` spawn: `--prompt-file` (stdin empty), single-object `json` output,
 * `-m`, `--reasoning-effort`, `--max-turns 1`, `--no-subagents`, `--no-plan`, `--disable-web-search`,
 * `--tools ""` plus every built-in tool denied, `--cwd` the empty sandbox, `--verbatim`, and the
 * leader socket inside the isolated root (no `--always-approve`, no permission-mode bypass).
 * Never `--resume`/`-c`: each turn starts fresh and the isolated root is deleted afterwards.
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
    "json",
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
