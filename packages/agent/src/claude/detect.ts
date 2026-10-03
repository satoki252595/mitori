import type { AuthKind, BillingMode, BinaryPin, EngineStatus, ErrorCode, Iso8601, SubscriptionWindow } from "@mitori/core";
import type { Spawner, SpawnSpec } from "../contract.ts";
import type { Timers } from "../util/timers.ts";

/** Flags the argv templates rely on (testing spec CC-02); `--system-prompt-file` is only mentioned, not listed. */
export const REQUIRED_FLAGS = [
  "--print",
  "--output-format",
  "--input-format",
  "--verbose",
  "--include-partial-messages",
  "--model",
  "--effort",
  "--tools",
  "--allowedTools",
  "--permission-mode",
  "--setting-sources",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--restricted",
  "--no-session-persistence",
  "--resume",
  "--json-schema",
  "--max-budget-usd",
  "--system-prompt",
  "--system-prompt-file",
  "--permission-prompts",
  "--session-id",
] as const;

const PROBE_TIMEOUT_MS = 10_000;

/** Flags mentioned anywhere in `--help` (`--system-prompt[-file]` counts for both spellings). */
export function helpFlags(help: string): Set<string> {
  const out = new Set<string>();
  for (const m of help.matchAll(/--[a-zA-Z][a-zA-Z0-9-]*(\[-file\])?/g)) {
    const base = m[0].replace("[-file]", "");
    out.add(base);
    if (m[1]) out.add(`${base}-file`);
  }
  return out;
}

/** The `--bare` option text (until the next option line). */
function bareBlock(help: string): string {
  const lines = help.split("\n");
  const i = lines.findIndex((l) => /^\s{1,6}--bare\b/.test(l));
  if (i < 0) return "";
  const block = [lines[i] as string];
  for (const l of lines.slice(i + 1)) {
    if (/^\s{1,6}-/.test(l)) break;
    block.push(l);
  }
  return block.join(" ");
}

/** Capability problems found in `--help` (missing flags; `--bare` becoming the `-p` default, ADR-0005). */
export function helpProblems(help: string): { capabilities: string[]; problems: { code: ErrorCode; message: string }[] } {
  const flags = helpFlags(help);
  const missing = REQUIRED_FLAGS.filter((f) => !flags.has(f) && !(f === "--print" && /(^|\s)-p,\s/.test(help)));
  const problems: { code: ErrorCode; message: string }[] = [];
  const fallback = "Push is unavailable: use Pull (mitori review) or Copy as prompt";
  if (missing.length > 0) problems.push({ code: "E_AGENT_CAPABILITY", message: `claude --help lacks ${missing.join(" ")}. ${fallback}` });
  if (/\bdefault\b/i.test(bareBlock(help)))
    problems.push({ code: "E_AGENT_CAPABILITY", message: `--bare looks like the -p default (subscription auth would be skipped). ${fallback}` });
  const capabilities = REQUIRED_FLAGS.filter((f) => flags.has(f)).map((f) => f.slice(2));
  return { capabilities, problems };
}

/** `claude auth status` JSON → auth/plan (only these fields are read; email/org are never kept). */
export function parseAuthStatus(text: string): { auth: AuthKind; plan?: string; problem?: { code: ErrorCode; message: string } } {
  let j: { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    return { auth: "unknown", problem: { code: "E_AGENT_AUTH", message: "claude auth status is not JSON" } };
  }
  if (j.loggedIn !== true) return { auth: "none", problem: { code: "E_AGENT_AUTH", message: "claude is not logged in (run `claude auth login`)" } };
  const method = typeof j.authMethod === "string" ? j.authMethod : "";
  const plan = typeof j.subscriptionType === "string" ? j.subscriptionType : undefined;
  const withPlan = <T extends object>(o: T): T & { plan?: string } => (plan === undefined ? o : { ...o, plan });
  if (method === "claude.ai") return withPlan({ auth: "subscription" as AuthKind });
  if (/api|key|console|token/i.test(method)) {
    return withPlan({
      auth: "api-key" as AuthKind,
      problem: { code: "E_AGENT_AUTH_SOURCE" as ErrorCode, message: "claude authenticates with an API key: runs would be billed" },
    });
  }
  return withPlan({ auth: "unknown" as AuthKind });
}

/** Run a short probe command; never throws. */
export async function runProbe(
  spawner: Spawner,
  timers: Timers,
  spec: Omit<SpawnSpec, "stdin" | "keepStdinOpen" | "timeoutMs" | "processGroup">,
): Promise<{ code: number; out: string }> {
  try {
    const child = spawner.spawn({ ...spec, stdin: "", keepStdinOpen: false, timeoutMs: PROBE_TIMEOUT_MS, processGroup: true });
    child.closeStdin();
    const t = timers.set(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // gone
      }
    }, PROBE_TIMEOUT_MS);
    const lines: string[] = [];
    const drain = (async () => {
      for await (const l of child.stdout) lines.push(l);
    })();
    const drainErr = (async () => {
      for await (const _ of child.stderr) {
        // discarded: probe stderr may contain account details
      }
    })();
    const code = await child.exited;
    await Promise.allSettled([drain, drainErr]);
    timers.clear(t);
    return { code, out: lines.join("\n") };
  } catch {
    return { code: -1, out: "" };
  }
}

export interface ProbeInput {
  spawner: Spawner;
  timers: Timers;
  binary: string | null;
  pin: BinaryPin | undefined;
  env: Record<string, string>;
  cwd: string;
  now: Iso8601;
  window: SubscriptionWindow | null;
}

/** detect(): `--version`, `auth status` (no tokens), `--help` capability probe. */
export async function probeClaude(i: ProbeInput): Promise<EngineStatus> {
  const base = (problems: EngineStatus["problems"]): EngineStatus => {
    const s: EngineStatus = { engine: "claude-cli", installed: false, auth: "unknown", capabilities: [], billing: "unknown", problems, checkedAt: i.now };
    if (i.pin) s.pin = i.pin;
    return s;
  };
  if (i.binary === null) return base([{ code: "E_AGENT_NOT_INSTALLED", message: "claude binary is not pinned (confirm it on the engine card)" }]);
  const common = { command: i.binary, env: i.env, cwd: i.cwd };
  const ver = await runProbe(i.spawner, i.timers, { ...common, argv: ["--version"] });
  if (ver.code !== 0) return base([{ code: "E_AGENT_NOT_INSTALLED", message: "claude --version failed" }]);
  const version = ver.out.split("\n")[0]?.trim() ?? "";
  const [auth, help] = await Promise.all([
    runProbe(i.spawner, i.timers, { ...common, argv: ["auth", "status"] }),
    runProbe(i.spawner, i.timers, { ...common, argv: ["--help"] }),
  ]);
  const a = parseAuthStatus(auth.out);
  const h =
    help.code === 0 ? helpProblems(help.out) : { capabilities: [], problems: [{ code: "E_AGENT_CAPABILITY" as ErrorCode, message: "claude --help failed" }] };
  const problems = [...h.problems];
  if (a.problem) problems.unshift(a.problem);
  if (i.pin && i.pin.version !== version) problems.unshift({ code: "E_ENGINE_BINARY_CHANGED", message: `claude changed from ${i.pin.version} to ${version}` });
  const billing: BillingMode = i.window?.billing ?? (a.auth === "subscription" ? "subscription-window" : a.auth === "api-key" ? "metered-api" : "unknown");
  const s: EngineStatus = {
    engine: "claude-cli",
    installed: true,
    version,
    path: i.binary,
    auth: a.auth,
    capabilities: h.capabilities,
    billing,
    problems,
    checkedAt: i.now,
  };
  if (a.plan !== undefined) {
    s.plan = a.plan;
    s.dataPolicyKey = `claude-cli.${a.plan}`;
  }
  if (i.window) s.window = i.window;
  if (i.pin) s.pin = i.pin;
  return s;
}
