/**
 * Hook payload parsing for `mitori touch --stdin` (loop spec §10.6) and the agent label of the Pull plane (§10).
 * Pure and isomorphic: POSIX path handling is done here (no `node:path` in domain code).
 */
import { TOUCH_LIMITS, type TouchHookInput } from "../contract.ts";

/** Max paths taken from one payload (a hook names one file; MultiEdit/NotebookEdit at most a handful). */
const MAX_PATHS = 64;
/** Labels sent as `x-mitori-agent` / message author `agent:<label>`. */
const LABEL_MAX = 32;

/** Lexically normalize an absolute POSIX path (`.`/`..`/`//` removed). Null for anything that is not absolute. */
export function normalizeAbs(p: string): string | null {
  if (!p.startsWith("/") || p.includes("\0")) return null;
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `/${out.join("/")}`;
}

/** `p` made absolute against `cwd` (both POSIX), normalized; null when neither is absolute. */
function absolute(p: string, cwd: string | undefined): string | null {
  if (p.startsWith("/")) return normalizeAbs(p);
  if (cwd === undefined || !cwd.startsWith("/") || p === "") return null;
  return normalizeAbs(`${cwd}/${p}`);
}

/** Paths named by one hook payload, absolute and de-duplicated in payload order. Never throws. */
export function pathsOfHook(stdin: string): string[] {
  if (stdin.length === 0 || stdin.length > TOUCH_LIMITS.maxStdinBytes) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(stdin);
  } catch {
    return [];
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [];
  const input = payload as TouchHookInput & { tool_input?: Record<string, unknown> };
  const cwd = typeof input.cwd === "string" ? input.cwd : undefined;
  const tool = input.tool_input;
  if (tool === null || typeof tool !== "object" || Array.isArray(tool)) return [];
  const out: string[] = [];
  for (const key of ["file_path", "notebook_path", "path"] as const) {
    const v = tool[key];
    if (typeof v !== "string") continue;
    const abs = absolute(v, cwd);
    if (abs !== null && abs !== "/" && !out.includes(abs)) out.push(abs);
    if (out.length >= MAX_PATHS) break;
  }
  return out;
}

/** `[a-z0-9-]`, no leading/trailing dash, ≤ 32 chars; "" when nothing usable is left. */
export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LABEL_MAX)
    .replace(/-+$/, "");
}

/** True when the environment says the caller is Codex (any `CODEX_*` variable except the user-level `CODEX_HOME`). */
export function isCodexEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  for (const [k, v] of Object.entries(env)) if (k.startsWith("CODEX_") && k !== "CODEX_HOME" && v !== undefined && v !== "") return true;
  return false;
}

/** `--agent` > `MITORI_AGENT` > `CLAUDECODE=1` ⇒ claude-code > `CODEX_*` ⇒ codex > `pull`. */
export function labelFromEnv(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): string {
  for (const raw of [flag, env.MITORI_AGENT]) {
    const label = raw === undefined ? "" : normalizeLabel(raw);
    if (label !== "") return label;
  }
  if (env.CLAUDECODE === "1") return "claude-code";
  if (isCodexEnv(env)) return "codex";
  return "pull";
}
