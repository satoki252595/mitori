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

/** Muse supports only the verified text-only argv profile; duplicate or extra options can override its policy. */
export function assertMuseTextOnlyArgv(argv: readonly string[]): void {
  const flags = new Set(["--json", "--disable-shell", "--disable-write", "--disable-web-tools", "--no-foreign-personal-context", "--no-session-log"]);
  const pairs = new Map([
    ["--model", "{model}"],
    ["--reasoning-effort", "{effort}"],
    ["--prompt-file", "{promptFile}"],
    ["--workspace", "{emptyCwd}"],
    ["--max-model-steps", "1"],
    ["--worktree", "off"],
    ["--approval-mode", "untrusted"],
    ["--approval-judge", "off"],
  ]);
  let valid = argv[0] === "exec";
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (flags.delete(arg)) continue;
    if (pairs.has(arg) && argv[i + 1] === pairs.get(arg)) {
      pairs.delete(arg);
      i++;
    } else valid = false;
  }
  if (!valid || flags.size || pairs.size) throw new MitoriError("E_CFG_INVALID", "Muse argv must preserve the text-only sandbox policy (ADR-0015)");
}

/** generic adapter spawn (global `engines.generic.argv`; prompt = system + bundle + contract text on stdin). */
export function buildGenericSpawn(
  req: EngineRequest,
  settings: EngineSettings["generic"],
  paths: { emptyCwd: string; promptFile?: string; museHooksFile?: string; museConfigRoot?: string },
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  if (req.mode === "agent") throw new MitoriError("E_UNSUPPORTED", "the generic engine has no agent mode (spec §6.11)");
  if (req.tools !== "none") throw new MitoriError("E_UNSUPPORTED", "the generic engine only accepts text-only requests");
  const [command, ...argv] = settings.argv;
  if (command === undefined || !command.startsWith("/")) throw new MitoriError("E_INVALID_INPUT", "engines.generic.argv[0] must be an absolute path");
  if (argv.some((arg) => arg.includes("{promptFile}")) && !paths.promptFile?.startsWith("/"))
    throw new MitoriError("E_PRECONDITION", "generic {promptFile} needs a secure absolute prompt file");
  const contract = req.jsonSchema === undefined ? "" : `\n\nReply with one JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`;
  const prompt = `${req.system}\n\n${(req.promptBlocks ?? [req.prompt]).join("\n\n")}${contract}`;
  const values: Record<string, string> = {
    model: req.model.replace(/^generic:/, ""),
    effort: req.effort,
    promptFile: paths.promptFile ?? "",
    emptyCwd: paths.emptyCwd,
  };
  const env = scrubEnv(parentEnv, []);
  if (settings.protocol === "muse-jsonl") {
    if (!paths.museHooksFile?.startsWith("/")) throw new MitoriError("E_PRECONDITION", "Muse needs a secure empty managed-hooks file");
    if (!paths.museConfigRoot?.startsWith("/")) throw new MitoriError("E_PRECONDITION", "Muse needs an isolated config root");
    env.TBH_MANAGED_HOOKS_PATH = paths.museHooksFile;
    env.XDG_CONFIG_HOME = paths.museConfigRoot;
    assertMuseTextOnlyArgv(argv);
    // Fixed gates override saved/passed settings. Echo verification: zero reminder child runs (ADR-0015).
    for (const gate of [
      "TODO_REMINDER",
      "MEMORY_REMINDER",
      "SKILL_REMINDER",
      "GOAL_REMINDER",
      "VERIFY_REMINDER",
      "SCOPE_REMINDER",
      "PLUGINS",
      "HOOK_SELECTED_SKILLS",
      "HOOK_SELECTED_SKILLS_APPLY",
      "AGENTS",
      "WORKFLOW_TOOL",
      "ARTIFACT_TOOL",
      "MONITOR",
      "VOICE",
      "LOCAL_SESSION_MESSAGING",
    ])
      env[`MUSE_EXPERIMENTAL_${gate}`] = "off";
    env.MUSE_EXPERIMENTAL_FOREIGN_PERSONAL_CONTEXT_KILL = "on";
  }
  return {
    command,
    argv: argv.map((arg) => arg.replace(/\{(model|effort|promptFile|emptyCwd)\}/g, (_match, key: string) => values[key] ?? "")),
    env,
    cwd: paths.emptyCwd,
    stdin: paths.promptFile ? "" : prompt,
    keepStdinOpen: false,
    timeoutMs: req.budget.ms > 0 ? req.budget.ms : (settings.turnMs ?? CLAUDE_MODE_DEFAULTS[req.mode].turnMs),
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
