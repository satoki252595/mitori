/**
 * @mitori/agent — `adapters/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { type ClaudeModelId, type EngineSettings, MitoriError, PRICING, type Result } from "@mitori/core";
import { scrubEnv } from "../claude/env.ts";
import { type AnthropicApiRequest, CLAUDE_MODE_DEFAULTS, CODEX_ARGV_TEMPLATE, type EngineRequest, type SpawnSpec } from "../contract.ts";
import { anthropicRequest } from "./anthropic-request.ts";

/** codex-cli spawn builder (after MVP). Agent mode is not supported until a no-shell config is verified. */
export function buildCodexSpawn(
  req: EngineRequest,
  settings: EngineSettings["codex-cli"],
  paths: { codexBinary: string; schemaFile: string | null; lastMessageFile: string; emptyCwd: string },
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  if (req.mode === "agent") throw new MitoriError("E_UNSUPPORTED", "codex-cli has no shell-free agent mode yet (spec §6.10)");
  if (!paths.codexBinary.startsWith("/")) throw new MitoriError("E_INVALID_INPUT", "codex binary must be a resolved absolute path");
  const model = req.model.startsWith("codex:") ? req.model.slice("codex:".length) : settings.model;
  const argv: string[] = [];
  for (let i = 0; i < CODEX_ARGV_TEMPLATE.length; i++) {
    const el = CODEX_ARGV_TEMPLATE[i] as string;
    if (el === "--output-schema" && paths.schemaFile === null) {
      i++; // no schema (answer): drop the flag and its value
      continue;
    }
    argv.push(
      el
        .replace("{emptyCwd}", paths.emptyCwd)
        .replace("{model}", model)
        .replace("{effort}", req.effort)
        .replace("{schemaFile}", paths.schemaFile ?? "")
        .replace("{lastMessageFile}", paths.lastMessageFile),
    );
  }
  return {
    command: paths.codexBinary,
    argv,
    env: scrubEnv(parentEnv, []),
    cwd: paths.emptyCwd,
    // no system-prompt flag: the system text leads stdin (spec §6.10)
    stdin: `${req.system}\n\n${req.prompt}`,
    keepStdinOpen: false,
    timeoutMs: CLAUDE_MODE_DEFAULTS[req.mode].turnMs,
    processGroup: true,
  };
}

/** generic adapter spawn (global `engines.generic.argv`; prompt = system + bundle + contract text on stdin). */
export function buildGenericSpawn(
  req: EngineRequest,
  settings: EngineSettings["generic"],
  paths: { emptyCwd: string },
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  if (req.mode === "agent") throw new MitoriError("E_UNSUPPORTED", "the generic engine has no agent mode (spec §6.11)");
  const [command, ...argv] = settings.argv;
  if (command === undefined || !command.startsWith("/")) throw new MitoriError("E_INVALID_INPUT", "engines.generic.argv[0] must be an absolute path");
  const contract = req.jsonSchema === undefined ? "" : `\n\nReply with one JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`;
  return {
    command,
    argv,
    env: scrubEnv(parentEnv, []),
    cwd: paths.emptyCwd,
    stdin: `${req.system}\n\n${req.prompt}${contract}`,
    keepStdinOpen: false,
    timeoutMs: CLAUDE_MODE_DEFAULTS.patch.turnMs,
    processGroup: true,
  };
}

/** Extract the contract JSON from free-form stdout (last ```json fence, else whole stdout). */
export function extractJsonFromText(stdout: string): Result<unknown> {
  const fences = [...stdout.matchAll(/```json[^\S\n]*\n([\s\S]*?)\n?```/g)];
  const body = fences.length > 0 ? (fences[fences.length - 1]?.[1] ?? "") : stdout;
  try {
    return { ok: true, value: JSON.parse(body.trim()) as unknown };
  } catch {
    const e = new MitoriError(
      "E_AGENT_PROTOCOL",
      fences.length > 0 ? "the last ```json fence is not valid JSON" : "stdout is not JSON and has no ```json fence",
    );
    return { ok: false, error: e.toData() };
  }
}

/** Build the anthropic-api request (answer/findings/patch only; agent mode routes to claude-cli). */
export function buildAnthropicRequest(req: EngineRequest): AnthropicApiRequest {
  if (req.mode === "agent") throw new MitoriError("E_UNSUPPORTED", "anthropic-api has no tool loop: agent mode runs on claude-cli (spec §6.12)");
  if (!(req.model in PRICING)) throw new MitoriError("E_INVALID_INPUT", `anthropic-api needs a full Claude model id, got ${req.model}`);
  return anthropicRequest(req, req.model as ClaudeModelId);
}
