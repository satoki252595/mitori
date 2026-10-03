// Hardened one-shot git calls (ADR-0012 decision 4, SEC-05): env built from EMPTY (+ PATH/HOME and the fixed GIT_*
// set; parent GIT_* are never inherited), stdin /dev/null unless input is piped, fixed `-c` safety config, timeout
// with SIGTERM → 2 s → SIGKILL.
import { constants } from "node:os";
import { MitoriError } from "@mitori/core";
import { KILL_POLICY } from "../spawn/spawner.ts";

/** Fixed env of every read-only git call (mirrors loop `GIT_ENV` minus the identity, which reads never need). */
export const GIT_READ_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_LFS_SKIP_SMUDGE: "1",
  LC_ALL: "C",
} as const;

/** Fixed `-c` config of every read: no fsmonitor command, raw paths, no colors/pager/auto-gc/signature checks. */
export const GIT_READ_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotepath=off",
  "-c",
  "core.precomposeunicode=true",
  "-c",
  "color.ui=never",
  "-c",
  "gc.auto=0",
  "-c",
  "log.showsignature=false",
  "--no-pager",
] as const;

/** Configuration of a {@link GitRunner}. */
export interface GitRunnerConfig {
  /** git executable (absolute). */
  git: string;
  /** cwd of every call (the work tree, or the git dir for bare repos). */
  cwd: string;
  /** Complete child env. */
  env: Record<string, string>;
  /** Extra `-c key=value` args (loop's neutralizers for untrusted command-bearing config). */
  config: () => readonly string[];
  /** Per-call timeout. */
  timeoutMs: number;
}

/** Result of one call. */
export interface GitResult {
  /** Exit code. */
  code: number;
  /** Raw stdout. */
  stdout: Uint8Array;
  /** stderr (truncated). */
  stderr: string;
}

/** Runs git subcommands. */
export interface GitRunner {
  /** Run; exit codes outside `ok` (default [0]) throw `E_GIT_FAILED`. */
  run(args: readonly string[], opts?: { input?: string; ok?: readonly number[] }): Promise<GitResult>;
  /** argv prefix (`git` + safety args) for long-lived processes. */
  argv(args: readonly string[]): string[];
}

const dec = new TextDecoder();

/** Create a runner. */
export function createGitRunner(cfg: GitRunnerConfig): GitRunner {
  const argv = (args: readonly string[]) => [cfg.git, ...GIT_READ_ARGS, ...cfg.config(), ...args];
  return {
    argv,
    async run(args, opts = {}) {
      const proc = Bun.spawn(argv(args), {
        cwd: cfg.cwd,
        env: cfg.env,
        stdin: opts.input !== undefined ? "pipe" : "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      if (opts.input !== undefined) {
        proc.stdin?.write(opts.input);
        void Promise.resolve(proc.stdin?.end()).catch(() => {});
      }
      let timedOut = false;
      let kill: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill(KILL_POLICY.tool.signal);
        kill = setTimeout(() => proc.kill("SIGKILL"), KILL_POLICY.tool.graceMs);
      }, cfg.timeoutMs);
      try {
        const [stdout, stderr] = await Promise.all([new Response(proc.stdout).bytes(), new Response(proc.stderr).text()]);
        await proc.exited;
        const code = proc.signalCode ? 128 + ((constants.signals as Record<string, number>)[proc.signalCode] ?? 0) : (proc.exitCode ?? 1);
        const sub = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-c") ?? "?";
        if (timedOut) throw new MitoriError("E_TIMEOUT", `git ${sub} timed out after ${cfg.timeoutMs} ms`, { params: { sub } });
        if (!(opts.ok ?? [0]).includes(code)) {
          const first = stderr.trim().split("\n")[0]?.slice(0, 300) ?? "";
          throw new MitoriError("E_GIT_FAILED", `git ${sub} failed (exit ${code}): ${first}`, { params: { sub, code } });
        }
        return { code, stdout, stderr: stderr.slice(0, 4000) };
      } finally {
        clearTimeout(timer);
        if (kill) clearTimeout(kill);
      }
    },
  };
}

/** NUL-separated fields (the trailing empty field dropped). */
export function splitZ(bytes: Uint8Array): string[] {
  const text = dec.decode(bytes);
  const parts = text.split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** RepoPaths are NFC (core §1); ASCII skips the normalization. */
export function nfc(p: string): string {
  for (let i = 0; i < p.length; i++) if (p.charCodeAt(i) > 0x7f) return p.normalize("NFC");
  return p;
}
