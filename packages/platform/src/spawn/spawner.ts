// Spawner over Bun.spawn: argv only (never a shell), the child's env is exactly the given map (PATH forced to
// SAFE_PATH when configured), optional process group (POSIX setsid / Windows Job Object), stdout/stderr pumped eagerly into line channels.
import { constants } from "node:os";
import { isAbsolute } from "node:path";
import { MitoriError } from "@mitori/core";
import { realTimers, type Timers } from "../clock/timers.ts";
import { LineChannel, pump } from "./lines.ts";
import { type ChildHandle, type KillSignal, type Spawner, type SpawnSpec, STDERR_KEEP_LINES } from "./types.ts";
import { type WindowsJobLauncher, windowsJobExecutable } from "./windows-job.ts";

/** Options of {@link createSpawner}. */
export interface SpawnerOptions {
  /** SAFE_PATH ({@link resolveSafePath}); when set, every child's PATH is exactly this value [SEC-10]. */
  safePath?: string;
  /** Verified native Job Object asset; required for Windows processGroup, never a shell/taskkill fallback. */
  windowsJobLauncher?: WindowsJobLauncher;
}

/** Signal escalation policy: send `signal`, wait `graceMs` for exit, then SIGKILL. */
export interface KillPolicy {
  /** First signal. */
  signal: KillSignal;
  /** Wait before SIGKILL. */
  graceMs: number;
}

/**
 * Engines get SIGINT → 8 s → SIGKILL (SIGTERM loses the `result` line; agent `SIGINT_GRACE_MS`); gates and git get
 * SIGTERM → 2 s → SIGKILL (testing spec PLAT-I-005, CONS-14). Windows group signals immediately close the native job;
 * cooperative POSIX interrupts and a terminal usage line cannot be guaranteed there.
 */
export const KILL_POLICY = {
  engine: { signal: "SIGINT", graceMs: 8_000 },
  tool: { signal: "SIGTERM", graceMs: 2_000 },
} as const satisfies Record<string, KillPolicy>;

function exitCodeOf(proc: { exitCode: number | null; signalCode: string | null }): number {
  if (proc.signalCode) return 128 + ((constants.signals as Record<string, number>)[proc.signalCode] ?? 0);
  return proc.exitCode ?? 1;
}

/** Resolve a bare command name through the CHILD's PATH (never the daemon's cwd or PATH). */
function resolveCommand(command: string, path: string | undefined): string {
  if (isAbsolute(command) || command.includes("/")) return command;
  const found = Bun.which(command, { PATH: path ?? "" });
  if (!found) throw new MitoriError("E_NOT_FOUND", `command not found on PATH: ${command}`, { params: { command } });
  return found;
}

/** The production {@link Spawner}. */
export function createSpawner(opts: SpawnerOptions = {}): Spawner {
  return {
    spawn(spec: SpawnSpec): ChildHandle {
      const env: Record<string, string> = { ...spec.env };
      if (opts.safePath !== undefined) env.PATH = opts.safePath;
      const pipeIn = spec.stdin.length > 0 || spec.keepStdinOpen;
      const command = resolveCommand(spec.command, env.PATH);
      const windowsGroup = process.platform === "win32" && spec.processGroup;
      const launcher = windowsGroup ? windowsJobExecutable(opts.windowsJobLauncher) : null;
      if (windowsGroup && !isAbsolute(command)) throw new MitoriError("E_INVALID_INPUT", "Windows job child requires an absolute executable");
      let proc: ReturnType<typeof Bun.spawn<"pipe" | "ignore", "pipe", "pipe">>;
      try {
        proc = Bun.spawn(launcher ? [launcher, command, ...spec.argv] : [command, ...spec.argv], {
          cwd: spec.cwd,
          env,
          stdin: pipeIn ? "pipe" : "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: !windowsGroup && spec.processGroup,
        });
      } catch (cause) {
        const code = (cause as { code?: string }).code ?? "?";
        throw new MitoriError(code === "ENOENT" ? "E_NOT_FOUND" : "E_INTERNAL", `cannot spawn ${command} (${code})`, { cause, params: { command, code } });
      }
      const out = new LineChannel();
      const err = new LineChannel(STDERR_KEEP_LINES);
      // `exited` does not wait for the pipes: a grandchild may hold them open after the leader exited.
      void pump(proc.stdout, out);
      void pump(proc.stderr, err);
      let stdinOpen = pipeIn;
      const sink = pipeIn ? proc.stdin : null;
      const write = (text: string) => {
        if (!sink || !stdinOpen) throw new MitoriError("E_PRECONDITION", "stdin of the child is closed");
        try {
          sink.write(text);
          void Promise.resolve(sink.flush()).catch(() => {});
        } catch {
          // the child exited; its exit code tells the caller what happened
        }
      };
      const closeStdin = () => {
        if (!sink || !stdinOpen) return;
        stdinOpen = false;
        try {
          void Promise.resolve(sink.end()).catch(() => {});
        } catch {}
      };
      if (spec.stdin.length > 0) write(spec.stdin);
      if (!spec.keepStdinOpen) closeStdin();
      let done = false;
      const exited = proc.exited.then(() => {
        done = true;
        stdinOpen = false;
        return exitCodeOf(proc);
      });
      return {
        pid: proc.pid,
        stdout: out,
        stderr: err,
        write,
        closeStdin,
        kill(signal) {
          try {
            // the group outlives its leader: grandchildren still get the signal after the leader exited
            // Windows has no cooperative POSIX SIGINT here. Terminating the wrapper closes its private job handle.
            if (windowsGroup) {
              if (!done) proc.kill("SIGKILL");
            } else if (spec.processGroup) process.kill(-proc.pid, signal);
            else if (!done) proc.kill(signal);
          } catch {
            // ESRCH: already gone
          }
        },
        exited,
      };
    },
  };
}

/** Send `policy.signal`, wait `policy.graceMs`, then SIGKILL. Resolves with the exit code. */
export async function stopChild(child: ChildHandle, policy: KillPolicy, timers: Timers = realTimers): Promise<number> {
  let id: unknown;
  const grace = new Promise<"grace">((resolve) => {
    id = timers.setTimeout(() => resolve("grace"), policy.graceMs);
  });
  child.kill(policy.signal);
  const first = await Promise.race([child.exited, grace]);
  if (first === "grace") child.kill("SIGKILL");
  else timers.clearTimeout(id);
  return child.exited;
}

/** Result of {@link runToExit}. */
export interface RunResult {
  /** Exit code (128 + signal number when killed). */
  code: number;
  /** stdout lines. */
  stdout: string[];
  /** stderr lines (tail). */
  stderr: string[];
  /** `spec.timeoutMs` elapsed and the child was stopped. */
  timedOut: boolean;
  /** `signal` aborted and the child was stopped. */
  cancelled: boolean;
}

/** Options of {@link runToExit}. */
export interface RunOptions {
  /** Escalation on timeout / abort (default {@link KILL_POLICY}.tool). */
  policy?: KillPolicy;
  /** Abort → stop the child. */
  signal?: AbortSignal;
  /** Timers (tests: a FakeClock). */
  timers?: Timers;
  /** Keep at most this many stderr lines (default 50). */
  stderrTail?: number;
  /** How long the pipes are still read after the child exited (default {@link PIPE_DRAIN_MS}). */
  drainMs?: number;
  /**
   * With `spec.processGroup`: SIGKILL whatever is left of the group once the leader exited. Gates: a test's background
   * job (`(sleep 2; ln -s ~/.aws/credentials leak) &`) would otherwise keep writing into the job worktree while the
   * agent's next turn reads it (only a process that leaves the group with setsid escapes; on Linux the gate's PID
   * namespace ends with it anyway).
   */
  reapGroup?: boolean;
}

/** {@link runToExit} keeps reading the pipes this long after the exit (a lingering grandchild may hold them). */
export const PIPE_DRAIN_MS = 500;

/** Spawn, collect every line, enforce `spec.timeoutMs` (> 0) and `signal` with the kill policy. For gates and tools. */
export async function runToExit(spawner: Spawner, spec: SpawnSpec, opts: RunOptions = {}): Promise<RunResult> {
  const policy = opts.policy ?? KILL_POLICY.tool;
  const timers = opts.timers ?? realTimers;
  const tail = opts.stderrTail ?? 50;
  const child = spawner.spawn(spec);
  let timedOut = false;
  let cancelled = false;
  let stopping: Promise<number> | null = null;
  const stop = () => {
    stopping ??= stopChild(child, policy, timers);
  };
  const timer =
    spec.timeoutMs > 0
      ? timers.setTimeout(() => {
          timedOut = true;
          stop();
        }, spec.timeoutMs)
      : null;
  const onAbort = () => {
    cancelled = true;
    stop();
  };
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  const stdout: string[] = [];
  const stderr: string[] = [];
  // after the result is returned the loops keep draining (a lingering writer never blocks or piles up) but keep nothing
  let collecting = true;
  const readers = Promise.all([
    (async () => {
      for await (const l of child.stdout) if (collecting) stdout.push(l);
    })(),
    (async () => {
      for await (const l of child.stderr) {
        if (!collecting) continue;
        stderr.push(l);
        if (stderr.length > tail) stderr.shift();
      }
    })(),
  ]);
  const code = await child.exited;
  if (timer !== null) timers.clearTimeout(timer);
  opts.signal?.removeEventListener("abort", onAbort);
  if (opts.reapGroup && spec.processGroup) child.kill("SIGKILL");
  // A grandchild that outlives the leader (a daemon the gate started) may hold the pipes open forever: read what is
  // left for at most `drainMs` after the exit, then return without it.
  let drainId: unknown;
  await Promise.race([
    readers,
    new Promise<void>((resolve) => {
      drainId = timers.setTimeout(resolve, opts.drainMs ?? PIPE_DRAIN_MS);
    }),
  ]);
  timers.clearTimeout(drainId);
  collecting = false;
  if (stopping) await stopping;
  return { code, stdout, stderr, timedOut, cancelled };
}
