// Structural copies of the agent contract B2/B4 shapes (`SpawnSpec`, `Spawner`, `ChildHandle`). platform may import
// only @mitori/core; the composition root assigns these objects to the @mitori/agent types, which checks the match.

/** Spawn specification (agent contract `SpawnSpec`). */
export interface SpawnSpec {
  /** Executable (absolute, or resolved through the child's PATH = SAFE_PATH). */
  command: string;
  /** Arguments (passed verbatim; no shell). */
  argv: string[];
  /** The child's COMPLETE environment (nothing is inherited from the daemon). */
  env: Record<string, string>;
  /** Working directory. */
  cwd: string;
  /** First text written to stdin. */
  stdin: string;
  /** Keep stdin open after writing `stdin`. */
  keepStdinOpen: boolean;
  /** Hard timeout of the first turn (enforced by the caller: engine bridge / {@link runToExit}). */
  timeoutMs: number;
  /** Start the child in its own process group (signals reach its children). */
  processGroup: boolean;
}

/** Signals mitori sends. */
export type KillSignal = "SIGINT" | "SIGTERM" | "SIGKILL";

/** Spawned child handle (agent contract `ChildHandle`). */
export interface ChildHandle {
  /** PID. */
  pid: number;
  /** stdout lines (`\n`-split, a trailing `\r` removed, UTF-8 decoded across chunk boundaries). */
  stdout: AsyncIterable<string>;
  /** stderr lines (same splitting; at most the last {@link STDERR_KEEP_LINES} are buffered while unread). */
  stderr: AsyncIterable<string>;
  /** Write to stdin. */
  write(text: string): void;
  /** Close stdin. */
  closeStdin(): void;
  /** Signal the child (or its process group when spawned with `processGroup`). */
  kill(signal: KillSignal): void;
  /** Exit code (128 + signal number when killed by a signal). */
  exited: Promise<number>;
}

/** Child process port (agent contract `Spawner`). */
export interface Spawner {
  /** Spawn. */
  spawn(spec: SpawnSpec): ChildHandle;
}

/** Unread stderr lines kept per child (older lines are dropped; the bridge keeps a 50-line tail anyway). */
export const STDERR_KEEP_LINES = 1000;
