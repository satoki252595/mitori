import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MitoriError } from "@mitori/core";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { createFakeClock } from "../testing.ts";
import { createSpawner, KILL_POLICY, resolveSafePath, runToExit, stopChild } from "./index.ts";
import { PIPE_DRAIN_MS } from "./spawner.ts";
import type { ChildHandle, SpawnSpec } from "./types.ts";

afterAll(cleanupTempDirs);

const SYS_PATH = "/usr/bin:/bin";
const spec = (command: string, argv: string[], over: Partial<SpawnSpec> = {}): SpawnSpec => ({
  command,
  argv,
  env: { PATH: SYS_PATH },
  cwd: tempDir(),
  stdin: "",
  keepStdinOpen: false,
  timeoutMs: 0,
  processGroup: false,
  ...over,
});
const lines = async (it: AsyncIterable<string>): Promise<string[]> => {
  const out: string[] = [];
  for await (const l of it) out.push(l);
  return out;
};
const firstLine = async (child: ChildHandle, want: string): Promise<void> => {
  for await (const l of child.stdout) if (l === want) return;
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("PLAT-I-005 Spawner", () => {
  const spawner = createSpawner();

  test("argv goes verbatim to the program (no shell: `;` and `$()` stay literal)", async () => {
    const child = spawner.spawn(spec("printf", ["%s\\n", "a; rm -rf /", "$(echo pwned)", "`id`", "*"]));
    expect(await lines(child.stdout)).toEqual(["a; rm -rf /", "$(echo pwned)", "`id`", "*"]);
    expect(await child.exited).toBe(0);
  });

  test("the child env is exactly the given map (parent GIT_* not inherited)", async () => {
    process.env.GIT_DIR = "/tmp/evil.git";
    process.env.MITORI_TOKEN = "secret";
    try {
      const child = spawner.spawn(spec("/usr/bin/env", [], { env: { A: "1", LANG: "C" } }));
      expect((await lines(child.stdout)).sort()).toEqual(["A=1", "LANG=C"]);
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.MITORI_TOKEN;
    }
  });

  test("PATH is SAFE_PATH: forced on the child and used to resolve bare commands", async () => {
    const evilDir = tempDir();
    writeFileSync(join(evilDir, "printf"), "#!/bin/sh\necho hijacked\n");
    chmodSync(join(evilDir, "printf"), 0o755);
    const safe = createSpawner({ safePath: SYS_PATH });
    const child = safe.spawn(spec("printf", ["%s\\n", "ok"], { env: { PATH: `${evilDir}:${SYS_PATH}` } }));
    expect(await lines(child.stdout)).toEqual(["ok"]);
    const env = safe.spawn(spec("/usr/bin/env", [], { env: { PATH: evilDir } }));
    expect(await lines(env.stdout)).toEqual([`PATH=${SYS_PATH}`]);
    let err: unknown;
    try {
      safe.spawn(spec("definitely-not-a-command-xyz", []));
    } catch (e) {
      err = e;
    }
    expect(MitoriError.is(err, "E_NOT_FOUND")).toBe(true);
  });

  test("a missing cwd is E_NOT_FOUND (no raw errno escapes)", () => {
    let err: unknown;
    try {
      spawner.spawn(spec("/bin/echo", ["x"], { cwd: "/definitely/not/here" }));
    } catch (e) {
      err = e;
    }
    expect(MitoriError.is(err, "E_NOT_FOUND")).toBe(true);
  });

  test("stdout lines: CRLF, multibyte split across chunks, a 1 MB line, unterminated tail", async () => {
    const child = spawner.spawn(spec(process.execPath, [join(import.meta.dir, "test", "emit.ts")]));
    const got = await lines(child.stdout);
    expect(got.length).toBe(5);
    expect(got.slice(0, 3)).toEqual(["crlf", "plain", "日本"]);
    expect(got[3]?.length).toBe(1024 * 1024);
    expect(got[4]).toBe("no-newline-at-end");
    expect(await child.exited).toBe(0);
  });

  test("stdin: initial text, write, keep open, close", async () => {
    const child = spawner.spawn(spec("cat", [], { stdin: "first\n", keepStdinOpen: true }));
    child.write("second\n");
    child.closeStdin();
    child.closeStdin();
    expect(await lines(child.stdout)).toEqual(["first", "second"]);
    expect(await child.exited).toBe(0);
    expect(() => child.write("late")).toThrow(MitoriError);
  });

  test("engine policy: SIGINT, then SIGKILL after exactly 8 s; SIGTERM is never sent", async () => {
    expect(KILL_POLICY.engine).toEqual({ signal: "SIGINT", graceMs: 8000 });
    const clock = createFakeClock();
    const child = spawner.spawn(
      spec("/bin/sh", ["-c", 'trap "echo got-int" INT; trap "echo got-term" TERM; echo ready; while :; do sleep 0.02; done'], { processGroup: true }),
    );
    const seen: string[] = [];
    const reader = (async () => {
      for await (const l of child.stdout) seen.push(l);
    })();
    while (!seen.includes("ready")) await Bun.sleep(5);
    let code: number | null = null;
    const stopping = stopChild(child, KILL_POLICY.engine, clock).then((c) => {
      code = c;
    });
    while (!seen.includes("got-int")) await Bun.sleep(5);
    clock.advance(7999);
    await Bun.sleep(30);
    expect(code).toBeNull();
    clock.advance(1);
    await stopping;
    await reader;
    expect(code === 137 || code === 128 + 9).toBe(true);
    expect(seen).not.toContain("got-term");
  });

  test("tool policy: SIGTERM, then SIGKILL after 2 s", async () => {
    expect(KILL_POLICY.tool).toEqual({ signal: "SIGTERM", graceMs: 2000 });
    const clock = createFakeClock();
    const child = spawner.spawn(spec("/bin/sh", ["-c", 'trap "echo got-term" TERM; echo ready; while :; do sleep 0.02; done'], { processGroup: true }));
    await firstLine(child, "ready");
    const stopping = stopChild(child, KILL_POLICY.tool, clock);
    await firstLine(child, "got-term");
    clock.advance(2000);
    expect(await stopping).toBe(137);
  });

  test("a cooperative child exits on the first signal (no SIGKILL needed)", async () => {
    const child = spawner.spawn(spec("sleep", ["30"]));
    expect(await stopChild(child, KILL_POLICY.tool)).toBe(128 + 15);
  });

  test("process group: SIGKILL reaches grandchildren", async () => {
    const child = spawner.spawn(spec("/bin/sh", ["-c", "sleep 30 & echo $!; wait"], { processGroup: true }));
    const it = child.stdout[Symbol.asyncIterator]();
    const grandchild = Number((await it.next()).value);
    expect(alive(grandchild)).toBe(true);
    child.kill("SIGKILL");
    await child.exited;
    for (let i = 0; i < 50 && alive(grandchild); i++) await Bun.sleep(10);
    expect(alive(grandchild)).toBe(false);
  });

  test("runToExit: collects output; timeout → SIGTERM → timedOut", async () => {
    const ok = await runToExit(spawner, spec("/bin/sh", ["-c", "echo out; echo err >&2; exit 3"]));
    expect(ok).toEqual({ code: 3, stdout: ["out"], stderr: ["err"], timedOut: false, cancelled: false });
    const slow = await runToExit(spawner, spec("sleep", ["30"], { timeoutMs: 50 }));
    expect(slow.timedOut).toBe(true);
    expect(slow.code).toBe(128 + 15);
    const ac = new AbortController();
    const p = runToExit(spawner, spec("sleep", ["30"]), { signal: ac.signal });
    ac.abort();
    expect((await p).cancelled).toBe(true);
  });

  test("runToExit returns after the exit even when a grandchild keeps the pipes open", async () => {
    expect(PIPE_DRAIN_MS).toBe(500);
    const t0 = performance.now();
    const r = await runToExit(spawner, spec("/bin/sh", ["-c", "(sleep 0.08; echo late; exec sleep 30) & echo $!; echo done"]), { drainMs: 50 });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.code).toBe(0);
    expect(r.stdout.slice(0, 2)).toEqual([expect.stringMatching(/^\d+$/), "done"]);
    // the grandchild writes ~80 ms after the start (normally after the result): nothing is appended afterwards
    const n = r.stdout.length;
    await Bun.sleep(Math.max(0, 140 - (performance.now() - t0)));
    expect(r.stdout.length).toBe(n);
    process.kill(Number(r.stdout[0]), "SIGKILL");
    // a timeout whose leader dies while a detached grandchild holds stdout does not hang either
    const slow = await runToExit(spawner, spec("/bin/sh", ["-c", "sleep 30 & echo $!; exec sleep 30"], { timeoutMs: 50 }), { drainMs: 50 });
    expect(slow.timedOut).toBe(true);
    process.kill(Number(slow.stdout[0]), "SIGKILL");
  });
});

describe("PLAT-U resolveSafePath (SEC-10)", () => {
  test("drops empty, relative, workspace-local, cwd-local and project tool dirs; keeps order; dedupes", () => {
    const path = [
      "/opt/homebrew/bin",
      "",
      ".",
      "bin",
      "/Users/me/work/repo/node_modules/.bin",
      "/Users/me/work/repo/scripts",
      "/Users/me/elsewhere/.venv/bin",
      "/home/me/cwd/tools/",
      "/usr/bin",
      "/usr/bin/",
      "/Users/me/work/repo2/bin",
      "/bin",
    ].join(":");
    expect(resolveSafePath(path, { workspaceRoots: ["/Users/me/work/repo"], startCwd: "/home/me/cwd" })).toBe(
      "/opt/homebrew/bin:/usr/bin:/Users/me/work/repo2/bin:/bin",
    );
  });

  test("a workspace at / does not drop everything; normalization catches `..` tricks", () => {
    expect(resolveSafePath("/usr/bin:/bin", { workspaceRoots: ["/"], startCwd: "/" })).toBe("/usr/bin:/bin");
    expect(resolveSafePath("/usr/bin:/r/x/../repo/bin", { workspaceRoots: ["/r/repo/"], startCwd: "/nowhere" })).toBe("/usr/bin");
  });
});
