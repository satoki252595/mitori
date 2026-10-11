/**
 * The production {@link Io}: process streams, stdin, the TTY prompt, the detached `mitori _serve`, the browser
 * opener. Children start through `@mitori/platform`'s Spawner (argv only, never a shell).
 */
import { platform } from "node:os";
import { MitoriError } from "@mitori/core";
import { createSafeWriter, createSpawner, cryptoRandom, systemClock } from "@mitori/platform";
import { materializeWindowsJob } from "../build/windows-job.ts";
import { DAEMON_WAIT } from "./daemon-client.ts";
import type { Io } from "./io.ts";

export { type AuthSpawn, spawnOfficialLogin } from "@mitori/platform";

/** argv that runs this mitori again: the compiled binary itself, or `bun <main.ts>` from a source checkout. */
export function selfCommand(): [string, ...string[]] {
  return Bun.isStandaloneExecutable ? [process.execPath] : [process.execPath, Bun.main];
}

const childEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return env;
};

/** Only the daemon that won its lock writes this PID to its private startup pipe. */
export async function daemonStartupPid(
  child: { stdout: AsyncIterable<string>; exited: Promise<number> },
  timeoutMs: number = DAEMON_WAIT.startMs,
): Promise<number> {
  if (timeoutMs <= 0) return 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([
      child.stdout[Symbol.asyncIterator]().next(),
      child.exited.then(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
    const match = first && !first.done ? /^mitori-daemon-pid ([1-9]\d*)$/.exec(first.value) : null;
    const pid = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(pid) ? pid : 0;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readStdin(maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of Bun.stdin.stream()) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new MitoriError("E_PAYLOAD_TOO_LARGE", `stdin is larger than ${maxBytes} bytes`, { params: { maxBytes } });
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function* stdinLines(): AsyncIterable<string> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of Bun.stdin.stream()) {
    buf += dec.decode(chunk, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      yield buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
  }
  buf += dec.decode();
  if (buf !== "") yield buf;
}

async function askYesNo(question: string): Promise<boolean> {
  process.stderr.write(`${question} [y/N] `);
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin });
  try {
    const line: string = await new Promise((resolve) => rl.once("line", resolve));
    return /^\s*(y|yes|はい)\s*$/i.test(line);
  } finally {
    rl.close();
  }
}

export function realIo(argv: string[], version: string): Io {
  const spawner = createSpawner();
  return {
    argv,
    version,
    env: process.env,
    cwd: process.cwd(),
    out: (t) => void process.stdout.write(t),
    err: (t) => void process.stderr.write(t),
    stdin: readStdin,
    lines: stdinLines,
    bin: Bun.isStandaloneExecutable ? process.execPath : "mitori",
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    confirm: askYesNo,
    async spawnDaemon(home, deadline) {
      const [command, ...pre] = selfCommand();
      const windows = process.platform === "win32";
      const windowsJobLauncher = windows ? await materializeWindowsJob(home, createSafeWriter()) : undefined;
      // Own session: the daemon outlives this CLI. Windows' handle PID belongs to the native wrapper.
      const child = createSpawner(windowsJobLauncher ? { windowsJobLauncher } : {}).spawn({
        command,
        argv: [...pre, "_serve", "--detached", ...(windows ? ["--startup-ack"] : [])],
        env: childEnv(),
        cwd: home,
        stdin: "",
        keepStdinOpen: false,
        timeoutMs: 0,
        processGroup: true,
      });
      return windows ? { pid: await daemonStartupPid(child, Math.max(0, deadline - systemClock.now())), exited: child.exited } : child;
    },
    async openUrl(url) {
      const opener = platform() === "darwin" ? "open" : "xdg-open";
      try {
        spawner.spawn({
          command: opener,
          argv: [url],
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
          cwd: "/",
          stdin: "",
          keepStdinOpen: false,
          timeoutMs: 0,
          processGroup: true,
        });
      } catch {
        // no opener on this machine: the URL is printed anyway
      }
    },
    clock: systemClock,
    random: cryptoRandom,
    fetch: globalThis.fetch,
  };
}

/** Wait until both streams flushed what the command wrote (the runner then exits the process). */
export async function drainStreams(): Promise<void> {
  await Promise.all([new Promise<void>((r) => process.stdout.write("", () => r())), new Promise<void>((r) => process.stderr.write("", () => r()))]);
}
