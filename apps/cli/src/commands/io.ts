/**
 * What every command runs against: argv, env, cwd, the two output streams, stdin and the injectable side effects
 * (daemon start, browser, clock, entropy). The real one is built by {@link realIo}; tests build their own and read
 * the captured text. Errors are printed as `error <CODE>: <message>` (+ `hint: …`) on stderr (loop spec §10).
 */
import { type Clock, type ErrorCode, MitoriError, type Random } from "@mitori/core";

/** Process-level effects a command may need; each is replaceable in tests. */
export interface Io {
  /** Arguments after the command name. */
  argv: string[];
  /** mitori version (`x-mitori-client: cli/<version>`, registry handshake). */
  version: string;
  /** This CLI process's start time (ISO): only a CLI started after the daemon may restart a stale idle one. */
  startedAt: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Working directory (absolute). */
  cwd: string;
  /** stdout / stderr (buffered by the runner; nothing else writes to the process streams). */
  out(text: string): void;
  err(text: string): void;
  /** Whole stdin, at most `maxBytes` (more ⇒ `E_PAYLOAD_TOO_LARGE`). */
  stdin(maxBytes: number): Promise<string>;
  /** stdin as lines, as they arrive (`mitori mcp`). */
  lines(): AsyncIterable<string>;
  /** How printed commands name this mitori (the binary's realpath, or `mitori` from a source checkout). */
  bin: string;
  /** stdin and stdout are a terminal (TTY-gated commands). */
  isTTY: boolean;
  /** Ask a yes/no question on the terminal (only called when {@link isTTY}). */
  confirm(question: string): Promise<boolean>;
  /** Start detached before `deadline` (clock.now); its real PID proves whether this call won the daemon lock. */
  spawnDaemon(
    home: string,
    deadline: number,
  ): { pid: number; exited: Promise<number> } | undefined | Promise<{ pid: number; exited: Promise<number> } | undefined>;
  /** Open a URL in the user's browser. */
  openUrl(url: string): Promise<void>;
  clock: Clock;
  random: Random;
  /** `fetch` used for every daemon call (tests: the in-process fake). */
  fetch: typeof fetch;
}

/** A failure with the exit code it maps to (2 = usage, 3 = expired prep, 10/11 = review). */
export class CliExit extends Error {
  constructor(
    readonly code: number,
    readonly error?: MitoriError,
    readonly hint?: string,
  ) {
    super(error?.message ?? `exit ${code}`);
  }
}

/** Usage error (exit 2). */
export const usage = (message: string, hint?: string) => new CliExit(2, new MitoriError("E_INVALID_INPUT", message), hint);

/** `error <CODE>: <message>` + `hint: …` (the caller's, the daemon's, or the built-in one for the code). */
export function formatError(e: MitoriError, hint?: string): string {
  const h = hint ?? e.hint ?? HINTS[e.code];
  return `error ${e.code}: ${e.message}\n${h ? `hint: ${h}\n` : ""}`;
}

const HINTS: Partial<Record<ErrorCode, string>> = {
  E_WS_NOT_PROJECT: "run mitori inside a project directory (or pass the path; --force overrides)",
  E_VERSION_MISMATCH: "let the running jobs finish, then run the command again (or `mitori stop`)",
  E_TTY_REQUIRED: "run it yourself in a terminal (agents cannot confirm it)",
  E_UNSUPPORTED: "this mitori daemon does not serve it yet",
  E_NOT_READY: "the workspace is still loading; try again in a moment",
  E_ENGINE_BINARY_CHANGED: "the engine binary changed after a vendor update: run `mitori setup claude` again to register it",
};

/** Exit code + stderr text of an error that escaped a command (usage errors 2, everything else 1). */
export function exitOf(e: unknown): { code: number; text: string } {
  if (e instanceof CliExit) return { code: e.code, text: e.error ? formatError(e.error, e.hint) : "" };
  return { code: 1, text: formatError(MitoriError.from(e)) };
}
