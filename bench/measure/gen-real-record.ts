// `--record <dir>` of bench/measure/gen-real.ts: tee every engine process of the daemon into JSON files.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Spawner } from "@mitori/agent";
import { createSpawner, resolveSafePath } from "@mitori/platform";

/** One recorded engine process. `env` keeps only the `CLAUDE_CODE_*` values mitori injects; `envKeys` lists all keys. */
export interface RecordedProcess {
  argv: string[];
  envKeys: string[];
  env: Record<string, string>;
  cwd: string;
  stdin: string;
  /** Later stdin writes (continuation retries). */
  writes: string[];
  /** stdout lines with the ms since spawn. */
  out: [number, string][];
  /** Exit code (absent while alive). */
  exit?: number;
  /** ms since spawn at exit. */
  exitMs?: number;
}

/**
 * The daemon's own platform spawner (or `inner`), teeing every engine process (argv, env, stdin, later stdin writes,
 * stdout lines with receive times) into `<dir>/<n>.json` for prompt analysis. Saved after each turn's `result` and at
 * exit. Never committed: prompts carry repository code.
 */
export function recordingSpawner(dir: string, inner?: Spawner): Spawner {
  mkdirSync(dir, { recursive: true });
  const real = inner ?? createSpawner({ safePath: resolveSafePath(process.env.PATH ?? "", { workspaceRoots: [], startCwd: process.cwd() }) });
  let n = 0;
  return {
    spawn(spec) {
      const child = real.spawn(spec);
      if (!spec.argv.includes("stream-json")) return child;
      const id = String(++n).padStart(3, "0");
      const t = performance.now();
      const rec: RecordedProcess = {
        argv: spec.argv,
        envKeys: Object.keys(spec.env).sort(),
        env: Object.fromEntries(Object.entries(spec.env).filter(([k]) => k.startsWith("CLAUDE_CODE_"))),
        cwd: spec.cwd,
        stdin: spec.stdin,
        writes: [],
        out: [],
      };
      const save = () => writeFileSync(join(dir, `${id}.json`), JSON.stringify(rec));
      void child.exited.then(
        (code) => {
          rec.exit = code;
          rec.exitMs = Math.round(performance.now() - t);
          save();
        },
        () => save(),
      );
      const stdout = (async function* () {
        for await (const l of child.stdout) {
          rec.out.push([Math.round(performance.now() - t), l]);
          if (l.startsWith('{"type":"result"')) save();
          yield l;
        }
      })();
      return {
        pid: child.pid,
        stdout,
        stderr: child.stderr,
        exited: child.exited,
        write: (text: string) => {
          rec.writes.push(text);
          child.write(text);
        },
        closeStdin: () => child.closeStdin(),
        kill: (s) => child.kill(s),
      };
    },
  };
}
