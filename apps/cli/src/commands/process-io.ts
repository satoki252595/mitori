/**
 * The production {@link Io}: process streams, stdin, the TTY prompt, the detached `mitori _serve`, the browser
 * opener. Children start through `@mitori/platform`'s Spawner (argv only, never a shell).
 */
import { platform } from "node:os";
import { MitoriError } from "@mitori/core";
import { createSpawner, cryptoRandom, systemClock } from "@mitori/platform";
import type { Io } from "./io.ts";

/** argv that runs this mitori again: the compiled binary itself, or `bun <main.ts>` from a source checkout. */
export function selfCommand(): [string, ...string[]] {
  return Bun.isStandaloneExecutable ? [process.execPath] : [process.execPath, Bun.main];
}

const childEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return env;
};

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
    spawnDaemon(home) {
      const [command, ...pre] = selfCommand();
      // own session (setsid): the daemon outlives this CLI; `--detached` keeps it off the closed pipes
      spawner.spawn({
        command,
        argv: [...pre, "_serve", "--detached"],
        env: childEnv(),
        cwd: home,
        stdin: "",
        keepStdinOpen: false,
        timeoutMs: 0,
        processGroup: true,
      });
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
