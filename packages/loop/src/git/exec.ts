// Hardened git calls over the `Spawner` port (ADR-0012 decision 4, SEC-05): the child env is built from EMPTY
// (+ PATH/HOME, the fixed `GIT_ENV`, per-call `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` and `GIT_CONFIG_*`
// overrides) — no parent `GIT_*` variable is ever inherited; stdin is /dev/null unless input is piped; every call
// has a timeout (SIGTERM → 2 s → SIGKILL on the process group) and the fixed `GIT_BASE_ARGS` (no repo hooks, no
// fsmonitor command, no transport but https).
import type { Spawner, SpawnSpec } from "@mitori/agent";
import { type Metrics, MitoriError } from "@mitori/core";
import { runToExit } from "@mitori/platform";
import { GIT_BASE_ARGS, GIT_ENV } from "../contract.ts";

/** Default per-call timeout (contract `GIT_ENV` comment: 30 s). */
export const GIT_TIMEOUT_MS = 30_000;

/** One `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` override (key and value travel separately: a driver named `a=b` stays intact). */
export type ConfigPair = readonly [key: string, value: string];

/** Options of one call. */
export interface GitCall {
  /** Working directory of the child. */
  cwd: string;
  /** `GIT_DIR`. */
  gitDir?: string;
  /** `GIT_WORK_TREE`. */
  workTree?: string;
  /** `GIT_INDEX_FILE` (a mitori temp index). */
  indexFile?: string;
  /** Text piped to stdin (otherwise /dev/null). */
  input?: string;
  /** Accepted exit codes (default [0]). */
  ok?: readonly number[];
  /** `GIT_CONFIG_*` overrides for this call (mirrored safe settings, neutralized command keys). */
  config?: readonly ConfigPair[];
  /** Extra fixed env (e.g. `GIT_LITERAL_PATHSPECS`). */
  env?: Readonly<Record<string, string>>;
  /**
   * The user's own repository hooks run (opt-in auto-commit, explicit commit, revert of an auto-commit): the
   * `core.hooksPath` override is left out. Everything else of `GIT_BASE_ARGS` stays.
   */
  userHooks?: boolean;
  /** Identity: mitori's (`GIT_ENV`, default) or the user's own config (commits in the user's repository). */
  identity?: "mitori" | "user";
  /** Timeout (default {@link GIT_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Cancellation. */
  signal?: AbortSignal;
}

/** Result of one call. stdout is the child's lines re-joined with `\n` (a lone trailing newline is not kept). */
export interface GitOut {
  /** Exit code. */
  code: number;
  /** stdout text. */
  out: string;
  /** stderr lines (tail). */
  err: string[];
}

/** Ports of the runner. */
export interface GitExecDeps {
  /** Spawner (argv only, never a shell). */
  spawner: Spawner;
  /** PATH (SAFE_PATH) and HOME (the user's global git config) of every child. Nothing else of the daemon env. */
  env: { PATH?: string | undefined; HOME?: string | undefined };
  /** Absolute `~/.mitori/run/nohooks` (an empty or missing directory: no hook is ever found there). */
  nohooks: string;
  /** `loop.git.calls`. */
  metrics?: Metrics;
}

const IDENTITY_KEYS = new Set(["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]);

/** First non-option argument that is not a `-c` value (for error messages). */
export function subcommandOf(args: readonly string[]): string {
  return args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-c") ?? "?";
}

/** `GIT_BASE_ARGS` with `{nohooks}` substituted; without the hooksPath pair when the user's hooks may run. */
export function baseArgs(nohooks: string, userHooks: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < GIT_BASE_ARGS.length; i += 2) {
    const value = GIT_BASE_ARGS[i + 1] as string;
    if (userHooks && value.startsWith("core.hooksPath=")) continue;
    out.push(GIT_BASE_ARGS[i] as string, value.replace("{nohooks}", nohooks));
  }
  return out;
}

/** The complete child env of one call (exported for GIT-S-03: nothing of the parent leaks in). */
export function childEnv(
  deps: Pick<GitExecDeps, "env">,
  call: Pick<GitCall, "gitDir" | "workTree" | "indexFile" | "config" | "env" | "identity">,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(GIT_ENV)) if (call.identity !== "user" || !IDENTITY_KEYS.has(k)) env[k] = v;
  if (deps.env.PATH) env.PATH = deps.env.PATH;
  if (deps.env.HOME) env.HOME = deps.env.HOME;
  if (call.env) Object.assign(env, call.env);
  if (call.gitDir) env.GIT_DIR = call.gitDir;
  if (call.workTree) env.GIT_WORK_TREE = call.workTree;
  if (call.indexFile) env.GIT_INDEX_FILE = call.indexFile;
  const pairs = call.config ?? [];
  if (pairs.length > 0) {
    env.GIT_CONFIG_COUNT = String(pairs.length);
    pairs.forEach(([k, v], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = k;
      env[`GIT_CONFIG_VALUE_${i}`] = v;
    });
  }
  return env;
}

/** Runs git subcommands through the Spawner. */
export class GitExec {
  constructor(private readonly deps: GitExecDeps) {}

  /** Run; an exit code outside `ok` throws `E_GIT_FAILED` (timeout ⇒ `E_TIMEOUT`, missing git ⇒ `E_NOT_FOUND`). */
  async run(args: readonly string[], call: GitCall): Promise<GitOut> {
    const sub = subcommandOf(args);
    const spec: SpawnSpec = {
      command: "git",
      argv: [...baseArgs(this.deps.nohooks, call.userHooks === true), ...args],
      env: childEnv(this.deps, call),
      cwd: call.cwd,
      stdin: call.input ?? "",
      keepStdinOpen: false,
      timeoutMs: call.timeoutMs ?? GIT_TIMEOUT_MS,
      processGroup: true,
    };
    this.deps.metrics?.inc("loop.git.calls");
    let r: Awaited<ReturnType<typeof runToExit>>;
    try {
      r = await runToExit(this.deps.spawner, spec, call.signal ? { signal: call.signal } : {});
    } catch (cause) {
      const e = MitoriError.from(cause);
      if (e.code === "E_NOT_FOUND") throw new MitoriError("E_NOT_FOUND", "git not found on PATH", { cause, params: { command: "git" } });
      throw new MitoriError("E_GIT_FAILED", `cannot run git ${sub}`, { cause, params: { sub } });
    }
    if (r.cancelled) throw new MitoriError("E_CANCELLED", `git ${sub} cancelled`, { params: { sub } });
    if (r.timedOut) throw new MitoriError("E_TIMEOUT", `git ${sub} timed out after ${spec.timeoutMs} ms`, { params: { sub } });
    if (!(call.ok ?? [0]).includes(r.code)) {
      const first = r.stderr.find((l) => l.trim() !== "")?.slice(0, 300) ?? "";
      throw new MitoriError("E_GIT_FAILED", `git ${sub} failed (exit ${r.code}): ${first}`, { params: { sub, code: r.code } });
    }
    return { code: r.code, out: r.stdout.join("\n"), err: r.stderr };
  }
}

/** NUL-separated fields of a `-z` output (empty fields dropped). */
export function splitZ(out: string): string[] {
  return out.split("\0").filter((f) => f.length > 0);
}

/** RepoPaths are NFC (core §1); ASCII skips the normalization. */
export function nfc(p: string): string {
  for (let i = 0; i < p.length; i++) if (p.charCodeAt(i) > 0x7f) return p.normalize("NFC");
  return p;
}
