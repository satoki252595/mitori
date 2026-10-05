import { type EngineSettings, MitoriError, PRICING, type RepoPath } from "@mitori/core";
import {
  AGENT_PATH_ALLOWED_RE,
  type BridgePaths,
  CLAUDE_ARGV,
  CLAUDE_FORBIDDEN_FLAGS,
  CLAUDE_FORBIDDEN_PERMISSION_MODES,
  CLAUDE_FORBIDDEN_TOOLS,
  type EngineRequest,
} from "../contract.ts";

/** I2 limits (bytes of UTF-8). */
export const ARGV_ELEMENT_MAX = 8 * 1024;
export const ARGV_TOTAL_MAX = 16 * 1024;

/** Tools of the agent profile (I8). `Write` is added only when the scope declares new files. */
export const AGENT_TOOLS = ["Read", "Edit", "Glob", "Grep"] as const;
/** Unconditional read rules of the agent profile (`--restricted` confines them to the worktree). */
export const AGENT_READ_RULES = ["Read", "Glob", "Grep"] as const;

/**
 * `BridgePaths` plus the `--session-id` mitori issues when sessions persist (I4).
 * CR-PENDING(WP-05): `BridgePaths.sessionId?` (docs/design/cr-requests/WP-05.md #3) — until then the engine passes it
 * as an extra property; the pure builder has no Random of its own.
 */
export type ClaudeSpawnPaths = BridgePaths & { sessionId?: string };

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SP_FILE_RE = /\/run\/sp\/[0-9a-f]{32}\.txt$/;
const MODEL_IDS: ReadonlySet<string> = new Set(Object.keys(PRICING));

const bad = (message: string, params?: Record<string, string | number | boolean>): never => {
  throw new MitoriError("E_INVALID_INPUT", message, params === undefined ? {} : { params });
};

const utf8Len = (s: string): number => new TextEncoder().encode(s).length;

/** True when `p` matches {@link AGENT_PATH_ALLOWED_RE} (SEC-09 allowlist). */
export const agentPathOk = (p: string): boolean => typeof p === "string" && AGENT_PATH_ALLOWED_RE.test(p);

/** `Edit(//<abs>/<path>)`; the worktree itself must be absolute and allowlist-clean (spaces/commas break the rule list). */
export function editRule(worktreeAbs: string, path: RepoPath): string {
  const wt = worktreeAbs.replace(/\/+$/, "");
  if (!wt.startsWith("/") || !agentPathOk(wt.slice(1)) || !agentPathOk(path)) {
    throw new MitoriError("E_UNSUPPORTED", "path cannot be expressed as an agent permission rule", { params: { reason: "agent_path" } });
  }
  return `Edit(//${wt.slice(1)}/${path})`;
}

/** Validate the request against the invariants that do not depend on argv assembly (I3, I6, I8, I9). */
export function validateClaudeRequest(req: EngineRequest, paths: ClaudeSpawnPaths): void {
  if (!MODEL_IDS.has(req.model)) bad(`claude-cli needs a full Claude model id, got ${req.model}`, { model: req.model });
  if (!paths.claudeBinary.startsWith("/")) bad("claude binary must be a resolved absolute path");
  if (!req.cwd.startsWith("/")) bad("cwd must be absolute");
  if (!SP_FILE_RE.test(paths.systemPromptFile)) bad("system prompt file must be ~/.mitori/run/sp/<sha256[:32]>.txt");
  if (!req.system.includes(`Working directory: ${req.cwd}`)) bad("system prompt must state `Working directory: <abs cwd>`");
  if (req.mode === "agent") {
    if (req.tools !== "read_edit") bad("agent mode needs the read_edit tool profile");
    if (req.cwd === paths.emptyCwd) bad("agent mode runs in the job worktree, not the empty sandbox");
    const scope = new Set(req.writeScope);
    for (const p of req.newFiles ?? []) if (!scope.has(p)) bad("newFiles must be part of writeScope");
  } else {
    if (req.tools !== "none") bad(`${req.mode} mode runs without tools`);
    if (req.cwd !== paths.emptyCwd) bad(`${req.mode} mode runs in the empty sandbox cwd`);
  }
  if (!(req.budget.usd > 0)) bad("budget.usd must be > 0");
}

/** Assemble argv from the `CLAUDE_ARGV` templates (the data is the single source of flags). */
export function assembleArgv(req: EngineRequest, settings: EngineSettings["claude-cli"], paths: ClaudeSpawnPaths): string[] {
  const schema = req.jsonSchema === undefined ? null : JSON.stringify(req.jsonSchema);
  if ((req.mode === "findings" || req.mode === "patch" || req.mode === "agent") && schema === null) bad(`${req.mode} mode needs a JSON schema`);
  const persist = settings.persistSessions && req.persistSession;
  if (req.resume !== undefined && !persist) bad("resume needs a persisted session (engines.claude-cli.persistSessions)");
  const sessionArgs = (): string[] => {
    if (req.resume !== undefined) return ["--resume", req.resume];
    const id = paths.sessionId;
    if (id === undefined || !UUID_V4_RE.test(id)) bad("persisted sessions need a mitori-issued uuidv4 session id");
    return ["--session-id", id as string];
  };
  const tools = [...AGENT_TOOLS, ...((req.newFiles?.length ?? 0) > 0 ? ["Write"] : [])].join(",");
  const subst = (el: string): string[] => {
    switch (el) {
      case "{model}":
        return [req.model];
      case "{effort}":
        return [req.effort];
      case "{systemPromptFile}":
        return [paths.systemPromptFile];
      case "{maxBudgetUsd}":
        return [req.budget.usd.toFixed(4)];
      case "{settingSources}":
        return [settings.inheritUserSettings ? "user" : ""];
      case "{schema}":
        return [schema as string];
      case "{tools}":
        return [tools];
      case "{allowedRules}":
        return [...AGENT_READ_RULES, ...req.writeScope.map((p) => editRule(req.cwd, p))];
      case "--no-session-persistence":
        return persist ? sessionArgs() : [el];
      default:
        return [el];
    }
  };
  const argv = [...CLAUDE_ARGV.common, ...CLAUDE_ARGV[req.mode]].flatMap(subst);
  if ((req.mode === "generate" || req.mode === "answer") && schema !== null) argv.push("--json-schema", schema);
  return argv;
}

/** Defence in depth (I2, I7): size limits, forbidden flags/permission modes/tools, no prompt text in argv. */
export function assertArgvSafe(argv: readonly string[], prompt: string): void {
  let total = 0;
  for (const el of argv) {
    const n = utf8Len(el);
    if (n > ARGV_ELEMENT_MAX) throw new MitoriError("E_PAYLOAD_TOO_LARGE", "argv element over 8 KiB (I2)", { params: { bytes: n } });
    total += n + 1;
  }
  if (total > ARGV_TOTAL_MAX) throw new MitoriError("E_PAYLOAD_TOO_LARGE", "argv over 16 KiB (I2)", { params: { bytes: total } });
  const forbidden: ReadonlySet<string> = new Set(CLAUDE_FORBIDDEN_FLAGS);
  argv.forEach((el, i) => {
    const flag = el.split("=")[0] as string;
    if (forbidden.has(flag)) throw new MitoriError("E_INTERNAL", `forbidden claude flag ${flag} (I7)`);
    const prev = argv[i - 1];
    if (prev === "--permission-mode" && (CLAUDE_FORBIDDEN_PERMISSION_MODES as readonly string[]).includes(el)) {
      throw new MitoriError("E_INTERNAL", `forbidden permission mode ${el} (I7)`);
    }
    if (prev === "--tools" && el.split(",").some((t) => (CLAUDE_FORBIDDEN_TOOLS as readonly string[]).includes(t.trim()))) {
      throw new MitoriError("E_INTERNAL", "forbidden tool in --tools (I7)");
    }
  });
  if (prompt.length >= 16 && argv.some((el) => el.includes(prompt))) throw new MitoriError("E_INTERNAL", "prompt text in argv (I2)");
}
