import type { ChildHandle, Spawner, SpawnSpec } from "../contract.ts";
import { Channel, deferred } from "../util/channel.ts";

/** One scripted output line (`phase: "after_sigint"` lines are emitted only after SIGINT). */
export interface ScriptLine {
  line?: string;
  stderr?: string;
  phase?: "main" | "after_sigint";
  /** Delay before this line (ms, scaled by `speed`). */
  dt?: number;
  /** Side effect run when the line is reached (replayed agent-mode file edits). */
  run?: () => void;
}

/** Scripted child process (testkit `ScriptedChild` shape + line-level script). */
export interface ScriptedChild {
  stdout?: readonly string[];
  stderr?: readonly string[];
  /** Exit code (default 0). */
  exitCode?: number;
  /** Delay before the first line (ms). */
  delayMs?: number;
  /** Never exit until killed. */
  hang?: boolean;
  /** Line script (takes precedence over `stdout`/`stderr`). */
  lines?: readonly ScriptLine[];
  /** Exit code after SIGINT (default 130). */
  sigintExit?: number;
}

/** A fake child with its observable side. */
export interface FakeChild extends ChildHandle {
  readonly spec: SpawnSpec;
  /** Everything written to stdin. */
  stdinText(): string;
  /** stdin closed. */
  readonly stdinClosed: boolean;
  /** Signals received in order. */
  readonly signals: readonly string[];
}

const isResult = (line: string | undefined): boolean => {
  if (!line) return false;
  try {
    return (JSON.parse(line) as { type?: unknown }).type === "result";
  } catch {
    return false;
  }
};

let nextPid = 40_000;

/**
 * Child driven by a script. Output starts when the prompt is complete (stdin closed, or — for a resident stream-json
 * process — the first full stdin line); each further `result` waits for one more stdin line (parking/continuation).
 */
export function scriptedChild(spec: SpawnSpec, script: ScriptedChild, opts: { speed?: number; maxDtMs?: number } = {}): FakeChild {
  const lines: ScriptLine[] = script.lines
    ? [...script.lines]
    : [...(script.stderr ?? []).map((s) => ({ stderr: s })), ...(script.stdout ?? []).map((l) => ({ line: l }))];
  if (script.delayMs && lines[0]) lines[0] = { ...lines[0], dt: (lines[0].dt ?? 0) + script.delayMs };
  const stdout = new Channel<string>();
  const stderr = new Channel<string>();
  const exited = deferred<number>();
  const signals: string[] = [];
  // like the platform spawner: `spec.stdin` is written at spawn and stdin is closed unless `keepStdinOpen`
  let stdin = spec.stdin;
  let stdinLines = stdin.split("\n").length - 1;
  let closed = !spec.keepStdinOpen;
  let done = false;
  let interrupted = false;
  let wake: (() => void) | null = null;
  const speed = opts.speed ?? 0;
  const maxDt = opts.maxDtMs ?? 200;
  const resident = spec.keepStdinOpen;

  const poke = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const waitFor = async (cond: () => boolean): Promise<void> => {
    while (!cond() && !done && !interrupted) await new Promise<void>((r) => (wake = r));
  };
  const sleep = (ms: number) => new Promise<void>((r) => globalThis.setTimeout(r, ms));
  const finish = (code: number): void => {
    if (done) return;
    done = true;
    stdout.close();
    stderr.close();
    exited.resolve(code);
    poke();
  };

  void (async () => {
    await waitFor(() => closed || (resident && stdinLines > 0));
    let turn = 1;
    let n = 0;
    for (const l of lines) {
      if (done || interrupted) break;
      if ((l.phase ?? "main") !== "main") continue;
      if (speed > 0 && (l.dt ?? 0) > 0) await sleep(Math.min(maxDt, (l.dt ?? 0) / speed));
      else if (++n % 16 === 0) await sleep(0);
      if (done || interrupted) break;
      l.run?.();
      if (l.stderr !== undefined) stderr.push(l.stderr);
      if (l.line !== undefined) {
        stdout.push(l.line);
        if (isResult(l.line)) {
          turn++;
          // the next turn starts with the next user message
          await waitFor(() => stdinLines >= turn || closed);
          if (closed && stdinLines < turn) break;
        }
      }
    }
    // an interrupted child is finished by kill(); a hung one only by SIGKILL
    if (done || interrupted || script.hang) return;
    if (resident) await waitFor(() => closed);
    if (!done && !interrupted) finish(script.exitCode ?? 0);
  })();

  return {
    spec,
    pid: nextPid++,
    stdout,
    stderr,
    exited: exited.promise,
    get stdinClosed() {
      return closed;
    },
    signals,
    stdinText: () => stdin,
    write(text: string): void {
      if (closed || done) throw new Error("stdin closed");
      stdin += text;
      stdinLines = stdin.split("\n").length - 1;
      poke();
    },
    closeStdin(): void {
      closed = true;
      poke();
    },
    kill(signal: "SIGINT" | "SIGTERM" | "SIGKILL"): void {
      signals.push(signal);
      if (done) return;
      if (signal === "SIGINT") {
        if (script.hang && !lines.some((l) => l.phase === "after_sigint")) return; // a hung child ignores SIGINT
        if (interrupted) return;
        interrupted = true;
        poke();
        globalThis.setTimeout(() => {
          if (done) return;
          for (const l of lines) if (l.phase === "after_sigint" && l.line !== undefined) stdout.push(l.line);
          finish(script.sigintExit ?? 130);
        }, 0);
      } else finish(signal === "SIGKILL" ? 137 : 143);
    },
  };
}

/** Spawner double: unmatched spawns throw (no silent real processes). */
export interface FakeSpawner extends Spawner {
  readonly calls: readonly SpawnSpec[];
  readonly children: readonly FakeChild[];
  script(match: (spec: SpawnSpec) => boolean, child: ScriptedChild | ((spec: SpawnSpec) => ScriptedChild)): FakeSpawner;
}

export function createFakeSpawner(opts: { speed?: number } = {}): FakeSpawner {
  const rules: { match: (spec: SpawnSpec) => boolean; child: ScriptedChild | ((spec: SpawnSpec) => ScriptedChild) }[] = [];
  const calls: SpawnSpec[] = [];
  const children: FakeChild[] = [];
  const self: FakeSpawner = {
    calls,
    children,
    script(match, child) {
      rules.push({ match, child });
      return self;
    },
    spawn(spec: SpawnSpec): ChildHandle {
      calls.push(spec);
      const rule = rules.find((r) => r.match(spec));
      if (!rule) throw new Error(`FakeSpawner: no script for ${spec.command} ${spec.argv.slice(0, 3).join(" ")}`);
      const c = scriptedChild(spec, typeof rule.child === "function" ? rule.child(spec) : rule.child, opts);
      children.push(c);
      return c;
    },
  };
  return self;
}
