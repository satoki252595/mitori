import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MitoriError } from "@mitori/core";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { createSpawner, runToExit } from "./spawner.ts";
import type { SpawnSpec } from "./types.ts";
import { windowsJobArgv, windowsJobExecutable } from "./windows-job.ts";

afterAll(cleanupTempDirs);
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

test("Job Object environment protocol carries exact names without values and refuses ambiguous names", () => {
  const argv = ["", "--", "日本語", 'a"b', "a\\"];
  expect(windowsJobArgv("C:\\Program Files\\engine.exe", argv, { TOKEN: "secret-must-stay-out-of-argv", PATH: "C:\\bin", EMPTY: "" })).toEqual([
    "--env-count",
    "3",
    "TOKEN",
    "PATH",
    "EMPTY",
    "--",
    "C:\\Program Files\\engine.exe",
    ...argv,
  ]);
  expect(windowsJobArgv("C:\\engine.exe", [], {})).toEqual(["--env-count", "0", "--", "C:\\engine.exe"]);
  expect(windowsJobArgv("C:\\engine.exe", [], { EMPTY: "" }, false)).toEqual(["--single-process", "--env-count", "1", "EMPTY", "--", "C:\\engine.exe"]);
  for (const env of [{ "": "x" }, { "A=B": "x" }, { "A\0B": "x" }, { PATH: "a", Path: "b" }])
    expect(() => windowsJobArgv("C:\\engine.exe", [], env)).toThrow(MitoriError);
});

test("Job Object asset refuses missing, modified and symlink executables before any spawn", () => {
  const root = realpathSync(tempDir()),
    path = join(root, "job.exe");
  writeFileSync(path, "trusted-native-fixture");
  const asset = { path, sha256: hash(readFileSync(path)) };
  expect(() => windowsJobExecutable(undefined)).toThrow(MitoriError);
  expect(windowsJobExecutable(asset)).toBe(path);
  writeFileSync(path, "replacement");
  expect(() => windowsJobExecutable(asset)).toThrow(MitoriError);
  const link = join(root, "link.exe");
  symlinkSync(path, link);
  expect(() => windowsJobExecutable({ path: link, sha256: hash("replacement") })).toThrow(MitoriError);
});

// Native Windows CI supplies the cross-built, recorded artifact; there is no taskkill or POSIX emulation.
const native = test.skipIf(process.platform !== "win32");
function fixture() {
  const path = realpathSync(process.env.MITORI_WINDOWS_JOB_LAUNCHER ?? resolve("node_modules/.cache/mitori-windows-job/windows-job-x64.exe"));
  const spawner = createSpawner({ windowsJobLauncher: { path, sha256: hash(readFileSync(path)) } });
  const cwd = realpathSync(tempDir());
  const env = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    MITORI_ONLY: "scoped fixture",
    MITORI_EMPTY: "",
    MITORI_日本語: "値=✓\n次",
    // The Nix-built standalone binary can serve as Bun; this child has an exact allowlisted environment.
    ...(process.env.BUN_BE_BUN === "1" ? { BUN_BE_BUN: "1" } : {}),
  };
  const spec = (script: string, args: string[] = [], extra: Partial<SpawnSpec> = {}): SpawnSpec => ({
    command: process.execPath,
    argv: ["-e", script, "--", ...args],
    cwd,
    env,
    stdin: "",
    keepStdinOpen: false,
    timeoutMs: 5000,
    processGroup: true,
    ...extra,
  });
  return { spawner, cwd, env, spec };
}

for (const processGroup of [true, false])
  native(
    `native ${processGroup ? "Job Object" : "single-child launcher"} preserves literal UTF-16 argv, exact environment, stdio and leader exit code`,
    async () => {
      const x = fixture();
      const args = ["", "日本語", "a\\", 'a"b', '\\"', "*", "?.exe", "a; $(echo unwanted)", "C:\\Program Files\\trailing\\"];
      const argv = await runToExit(x.spawner, x.spec("console.log(JSON.stringify(process.argv.slice(1)))", args, { processGroup }));
      expect(argv.code).toBe(0);
      expect(JSON.parse(argv.stdout[0] ?? "null")).toEqual(args);
      const input = "最初の行\nsecond line\n";
      const stdio = await runToExit(
        x.spawner,
        x.spec('const text=await Bun.stdin.text();process.stdout.write(text);console.error("stderr only");process.exit(7)', [], { stdin: input, processGroup }),
      );
      expect(stdio).toMatchObject({ code: 7, stdout: ["最初の行", "second line"], stderr: ["stderr only"], timedOut: false });
      const env = await runToExit(x.spawner, x.spec("console.log(JSON.stringify(process.env))", [], { processGroup }));
      expect(JSON.parse(env.stdout[0] ?? "null")).toEqual(x.env);
      expect(() => createSpawner().spawn(x.spec("console.log('must not start')", [], { processGroup }))).toThrow(MitoriError);
    },
  );

const descendant = (marker: string) => `await Bun.sleep(500);await Bun.write(${JSON.stringify(marker)},"escaped");`;
const leader = (marker: string, exit: boolean, leaderMarker?: string) => {
  const whileAlive = leaderMarker ? `await Bun.sleep(500);await Bun.write(${JSON.stringify(leaderMarker)},"leader survived");` : "";
  return `Bun.spawn([process.execPath,"-e",${JSON.stringify(descendant(marker))}],{stdin:"ignore",stdout:"ignore",stderr:"ignore",detached:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,BUN_BE_BUN:process.env.BUN_BE_BUN}});console.log("ready");${exit ? "process.exit(0)" : `${whileAlive}await Bun.sleep(10000)`};`;
};

native("descendant fixture can write after its ungrouped leader exits (positive control)", async () => {
  const x = fixture(),
    marker = join(x.cwd, "positive-control.txt");
  const result = await runToExit(x.spawner, x.spec(leader(marker, true), [], { processGroup: false }));
  expect(result.code).toBe(0);
  await Bun.sleep(750);
  expect(existsSync(marker)).toBe(true);
});

native("leader exit closes the job and kills detached descendants before they can write", async () => {
  const x = fixture(),
    marker = join(x.cwd, "grandchild-after-exit.txt");
  const result = await runToExit(x.spawner, x.spec(leader(marker, true)));
  expect(result.code).toBe(0);
  expect(result.stdout).toEqual(["ready"]);
  await Bun.sleep(750);
  expect(existsSync(marker)).toBe(false);
});

native("every cancellation signal hard-stops the job including independently detached grandchildren", async () => {
  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    const x = fixture(),
      marker = join(x.cwd, `${signal}.txt`);
    const child = x.spawner.spawn(x.spec(leader(marker, false)));
    let ready = false;
    for await (const line of child.stdout)
      if (line === "ready") {
        ready = true;
        break;
      }
    expect(ready).toBe(true);
    child.kill(signal);
    expect(await child.exited).not.toBe(0);
    await Bun.sleep(750);
    expect(existsSync(marker)).toBe(false);
  }
});

native("single-child cancellation stops the leader while independently detached grandchildren survive", async () => {
  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    const x = fixture(),
      marker = join(x.cwd, `${signal}-descendant.txt`),
      leaderMarker = join(x.cwd, `${signal}-leader.txt`);
    const child = x.spawner.spawn(x.spec(leader(marker, false, leaderMarker), [], { processGroup: false }));
    let ready = false;
    for await (const line of child.stdout)
      if (line === "ready") {
        ready = true;
        break;
      }
    expect(ready).toBe(true);
    child.kill(signal);
    expect(await child.exited).not.toBe(0);
    await Bun.sleep(750);
    expect(existsSync(leaderMarker)).toBe(false);
    expect(existsSync(marker)).toBe(true);
  }
});
