import { type EngineSettings, MitoriError } from "@mitori/core";
import { scrubEnv } from "../claude/env.ts";
import { CLAUDE_MODE_DEFAULTS, type EngineRequest, type SpawnSpec } from "../contract.ts";

/** Agent definition the isolated cwd carries (its directory holds nothing else). */
export const ANTIGRAVITY_AGENT = "mitori-text" as const;

/** One-line description of the isolated agent (shown in agy; the agent never uses tools). */
export const ANTIGRAVITY_AGENT_DESCRIPTION = "Text-only writer. Never uses tools." as const;

/**
 * The per-call agent file (`.agents/agents/mitori-text.md`, host-verified 2026-11-04, agy 1.4.12):
 * an empty toolset stops the model from using tools ("view_file も search_web も使えない" with this
 * agent). `init.tools` still lists 60 tools, so that list is never trusted — only the folded
 * `step_update` events decide fail-closed. `name` must stay equal to {@link ANTIGRAVITY_AGENT}
 * (the `--agent` value); agy rejects the turn as `unknown agent` otherwise.
 */
export const ANTIGRAVITY_AGENT_MD = `---
name: ${ANTIGRAVITY_AGENT}
description: "${ANTIGRAVITY_AGENT_DESCRIPTION}"
tools: []
mainAgent: true
subagent: false
---
Text-only: answer from the supplied prompt without tools, file access, commands, or delegation.
`;

/**
 * Every flag `buildAntigravitySpawn` passes (the follow capability gate checks `agy --help` for all
 * of them; `-p` is the short form of `--print`, matched like grok's `-m`).
 */
export const AGY_REQUIRED_FLAGS = ["--input-format", "--output-format", "--model", "--agent", "--disable-slash-commands", "-p"] as const;

/** True when `agy --help` documents every flag mitori passes (plus `--print` for `-p`). */
export function antigravityCapabilityOk(help: string): boolean {
  if (!AGY_REQUIRED_FLAGS.every((f) => (f === "-p" ? help.includes("--print") || /(?:^|\s)-p[\s,=:]/m.test(help) : help.includes(f)))) return false;
  return true;
}

/** stderr markers that the subscription login is missing (matched before the 60 s wait elapses). */
export const AGY_AUTHENTICATED_RE = /authentication failed or timed out/i;
export const AGY_AUTH_URL_RE = /accounts\.google\.com|google\.com\/(o\/oauth|auth)|antigravity\.google\/auth|sign in with google|verification code/i;

/** agy rejected the isolated agent definition (the frontmatter `name` drifted from `--agent`). */
export const AGY_UNKNOWN_AGENT_RE = /unknown agent/i;

/** One folded antigravity turn (`--output-format stream-json`, one event per line). */
export interface AntigravityTurn {
  /**
   * Turn text. Streaming `agent_response` `text_delta`s accumulate here for progress display; once the
   * terminal `result` arrives on SUCCESS this becomes `result.response` verbatim (WP40g: the last
   * `agent_response` chunk may ride with the usage row, so deltas alone can drop the tail).
   */
  text: string;
  /** Terminal `result.response` (null until the `result` arrives or when it is not a string). */
  response: string | null;
  /** Terminal usage when the `result` carried it (else the caller byte-estimates). */
  usage: { in: number; out: number; thinking: number; cacheRead: number } | null;
  /** First non-`user_input`/`agent_response` step (`<step_type>:<tool_name>`), if the turn ran a tool. */
  toolStep: string | null;
  /** True once an `error_message` step arrived (a failure precursor even when the `result` says SUCCESS). */
  errorMessage: boolean;
  /** Terminal `denied_actions` (null until the `result` arrives). */
  denied: string[] | null;
  /** Error carried by the stream, if any. */
  streamError: string | null;
  /** Terminal `status` (`SUCCESS` is normal). */
  status: string | null;
  /** True once the terminal `result` arrived. */
  ended: boolean;
}

/** Empty fold state. */
export const emptyAntigravityTurn = (): AntigravityTurn => ({
  text: "",
  response: null,
  usage: null,
  toolStep: null,
  errorMessage: false,
  denied: null,
  streamError: null,
  status: null,
  ended: false,
});

const safeInt = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

/** Token usage carried by a `result` (null when absent). */
function antigravityUsageOf(raw: unknown): AntigravityTurn["usage"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;
  const input = safeInt(u.input_tokens);
  const output = safeInt(u.output_tokens);
  if (input === null || output === null) return null;
  // thinking tokens are billed as output (WP40)
  const thinking = safeInt(u.thinking_tokens) ?? 0;
  return { in: input, out: output + thinking, thinking, cacheRead: safeInt(u.cache_read_tokens) ?? 0 };
}

/**
 * Fold one agy stdout line into the turn. `init` is ignored entirely: with the tools-less agent its
 * `tools` still lists 60 entries, so the list cannot gate anything. `step_update` accumulates
 * `agent_response` `text_delta`s (usage rows included) and ignores `user_input`; `error_message`
 * records a failure precursor (failed even on a SUCCESS `result`); any other `step_type`
 * (`tool`, …) records the tool and the caller fails the turn. The `result` closes the
 * turn (`SUCCESS` is normal) and carries the authoritative `response`, usage (`input_tokens`,
 * `output_tokens` + `thinking_tokens` billed as output, `cache_read_tokens`) and `denied_actions` —
 * a `response` that largely disagrees with the streamed deltas is a protocol violation. Unknown events
 * are ignored so a newer CLI cannot break the parser; non-JSON stdout lines are a protocol violation
 * (headless logs go to stderr).
 */
export function antigravityFoldLine(state: AntigravityTurn, line: string): AntigravityTurn {
  if (!line.trim()) return state;
  let obj: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(line);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    obj = v as Record<string, unknown>;
  } catch {
    throw new MitoriError("E_AGENT_PROTOCOL", "agy stdout is not stream-json");
  }
  const event = typeof obj.event === "string" ? obj.event : null;
  if (event === null) throw new MitoriError("E_AGENT_PROTOCOL", "agy stdout line has no event");
  if (event === "init") return state;
  if (event === "step_update") {
    const su = obj.step_update;
    if (!su || typeof su !== "object" || Array.isArray(su)) throw new MitoriError("E_AGENT_PROTOCOL", "agy step_update is invalid");
    const s = su as Record<string, unknown>;
    // usage rides on an `agent_response` row too (the terminal DONE carries the last `text_delta` with it):
    // record the usage but keep folding the row's text below instead of returning early (WP40g).
    let next = state;
    if (s.usage !== undefined && s.usage !== null) {
      const u = antigravityUsageOf(s.usage);
      if (u) next = { ...next, usage: u };
    }
    const stepType = typeof s.step_type === "string" ? s.step_type : null;
    if (stepType === null) throw new MitoriError("E_AGENT_PROTOCOL", "agy step_update has no step_type");
    if (stepType === "agent_response") {
      if (s.text_delta !== undefined && typeof s.text_delta !== "string") throw new MitoriError("E_AGENT_PROTOCOL", "agy text_delta is invalid");
      const text = typeof s.text_delta === "string" ? s.text_delta : "";
      if (text) next = { ...next, text: next.text + text };
      if (s.state === "ERROR" && state.toolStep === null && s.tool_name === undefined) return { ...next, streamError: next.streamError ?? "agy step failed" };
      return next;
    }
    if (stepType === "user_input") return state;
    // `error_message` is agy's own failure notice (e.g. a reset connection): a precursor the
    // result may still call SUCCESS, so the engine fails the turn without using its text.
    if (stepType === "error_message") return { ...next, errorMessage: true };
    // fail-closed: any other step ran something mitori did not allow (tool, …).
    if (state.toolStep !== null) return state;
    const tool = typeof s.tool_name === "string" && s.tool_name ? s.tool_name : stepType;
    return { ...state, toolStep: `${stepType}:${tool}`.slice(0, 160) };
  }
  if (event === "result") {
    const r = obj.result;
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new MitoriError("E_AGENT_PROTOCOL", "agy result is invalid");
    const res = r as Record<string, unknown>;
    const status = typeof res.status === "string" ? res.status : null;
    let next: AntigravityTurn = { ...state, ended: true, status };
    const denied = res.denied_actions;
    if (denied !== undefined) {
      if (!Array.isArray(denied) || !denied.every((d) => typeof d === "string")) throw new MitoriError("E_AGENT_PROTOCOL", "agy denied_actions is invalid");
      next = { ...next, denied: (denied as string[]).slice(0, 32) };
    } else next = { ...next, denied: [] };
    if (res.usage !== undefined && res.usage !== null) {
      const u = antigravityUsageOf(res.usage);
      if (u) next = { ...next, usage: u };
      else if (status === "SUCCESS") throw new MitoriError("E_AGENT_PROTOCOL", "agy result usage is invalid");
    }
    if (status === "SUCCESS") {
      // The response is the turn text (the real agy writes the whole body here): the streamed deltas are
      // progress display only. When they largely disagree neither side can be trusted (WP40g).
      if (typeof res.response !== "string") throw new MitoriError("E_AGENT_PROTOCOL", "agy result response is invalid");
      if (!sameAntigravityBody(res.response, next.text)) throw new MitoriError("E_AGENT_PROTOCOL", "agy result response and streamed text disagree");
      next = { ...next, text: res.response, response: res.response };
    } else if (typeof res.response === "string") {
      next = { ...next, response: res.response };
    }
    if (status !== "SUCCESS") {
      const message = typeof res.error === "string" && res.error ? res.error : `agy failed with status ${status ?? "unknown"}`;
      next = { ...next, streamError: message.slice(0, 500) };
    }
    return next;
  }
  return state;
}

/**
 * True when the terminal `result.response` and the streamed `text_delta` concatenation agree (WP40g).
 * Only newline differences are forgiven; anything else means neither side can be trusted.
 */
const sameAntigravityBody = (response: string, streamed: string): boolean => {
  const norm = (s: string): string => s.replace(/\r\n/g, "\n").replace(/[\r\n]+$/, "");
  return norm(response) === norm(streamed);
};

/** API-equivalent prices for one Antigravity model id: per-model entry first, then the engine `pricing`. */
export function antigravityPricing(
  settings: EngineSettings["antigravity-cli"],
  modelId: string,
): NonNullable<EngineSettings["antigravity-cli"]["pricing"]> | undefined {
  return settings.pricingByModel?.[modelId] ?? settings.pricing;
}

/** Paths the antigravity spawn needs (both absolute, created per call and removed afterwards). */
export interface AntigravitySpawnPaths {
  /** Resolved absolute path of the user's unmodified `agy`. */
  agyBinary: string;
  /** Isolated `HOME` for this turn (carries only the keychain link; never the user's `~/.gemini`). */
  home: string;
  /** Empty cwd holding only `.agents/agents/mitori-text.md`. */
  workdir: string;
}

/**
 * Single-turn text-only `agy` spawn (decided argv, WP40): `--input-format stream-json`
 * `--output-format stream-json --model <id>-<effort> --agent mitori-text --disable-slash-commands`
 * with `-p=` last (a flag after `-p` would be read as the prompt). The prompt travels on stdin as
 * one stream-json user line and stdin closes at once, so it never appears in `ps`. No agent/patch
 * modes, no tools: `step_update` events outside `user_input`/`agent_response` fail the turn.
 */
export function buildAntigravitySpawn(
  req: EngineRequest,
  settings: EngineSettings["antigravity-cli"],
  paths: AntigravitySpawnPaths,
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  if (!paths.agyBinary.startsWith("/")) throw new MitoriError("E_INVALID_INPUT", "agy binary must be a resolved absolute path");
  if (!paths.home.startsWith("/")) throw new MitoriError("E_PRECONDITION", "agy needs an isolated HOME root");
  if (!paths.workdir.startsWith("/")) throw new MitoriError("E_PRECONDITION", "agy needs a secure empty workdir");
  if (req.mode === "agent" || req.mode === "patch") throw new MitoriError("E_UNSUPPORTED", "the antigravity engine has no agent or patch mode (text-only)");
  if (req.tools !== "none") throw new MitoriError("E_UNSUPPORTED", "the antigravity engine only accepts text-only requests");
  if (req.effort !== "low" && req.effort !== "medium" && req.effort !== "high")
    throw new MitoriError("E_INVALID_INPUT", `antigravity models take --effort low|medium|high, got ${req.effort}`);
  const model = req.model.startsWith("antigravity:") ? req.model.slice("antigravity:".length) : settings.model;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model))
    throw new MitoriError("E_INVALID_INPUT", "antigravity requests must name an exact antigravity:<model> id");
  const contract = req.jsonSchema === undefined ? "" : `\n\nReply with one JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`;
  const text = `${req.system}\n\n${(req.promptBlocks ?? [req.prompt]).join("\n\n")}${contract}`;
  const argv = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    `${model}-${req.effort}`,
    "--agent",
    ANTIGRAVITY_AGENT,
    "--disable-slash-commands",
    "-p=",
  ];
  const env = scrubEnv(parentEnv, []);
  // The isolated home carries only the keychain link; the real HOME (hooks, plugins, history, skills) is unreachable.
  env.HOME = paths.home;
  return {
    command: paths.agyBinary,
    argv,
    env,
    cwd: paths.workdir,
    stdin: `${JSON.stringify({ event: "user", message: { content: text } })}\n`,
    keepStdinOpen: false,
    timeoutMs: req.budget.ms > 0 ? req.budget.ms : (settings.turnMs ?? CLAUDE_MODE_DEFAULTS[req.mode].turnMs),
    processGroup: true,
  };
}
