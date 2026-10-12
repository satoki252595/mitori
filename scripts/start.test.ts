import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { BUILD_ENV } from "./lib/build-id.ts";
import { ROOT } from "./lib/repo.ts";
import {
  assetsReady,
  attemptBunRollover,
  BUN_ROLLOVER_GUARD,
  exportBuildId,
  listBunCandidates,
  rolloverNotice,
  sourceFingerprint,
  start,
  supportedBun,
} from "./start.ts";

test("startup rejects Bun versions incompatible with the frozen lockfile and compares numeric version parts", () => {
  for (const version of ["1.3.13", "1.4.1", "not a version"]) expect(supportedBun(version)).toBe(false);
  for (const version of ["1.4.2", "1.4.3", "1.10.0", "2.0.0"]) expect(supportedBun(version)).toBe(true);
});

test("startup refreshes changed/deleted source and missing output, and reuses intact production assets", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-"));
  try {
    writeFileSync(join(root, "source.ts"), "one");
    const fingerprint = sourceFingerprint(root, ["source.ts"]);
    expect(assetsReady(root, fingerprint)).toBe(false);
    mkdirSync(join(root, "dist/.build/initial"), { recursive: true });
    writeFileSync(join(root, "dist/.build/start.sha256"), fingerprint);
    writeFileSync(join(root, "dist/.build/initial/initial.js"), "export {};");
    writeFileSync(join(root, "dist/.build/index.html"), "<!doctype html>");
    writeFileSync(join(root, "dist/.build/web.json"), JSON.stringify({ "/index.html": { raw: "dist/.build/index.html" } }));
    expect(assetsReady(root, fingerprint)).toBe(true);
    writeFileSync(join(root, "source.ts"), "two");
    expect(sourceFingerprint(root, ["source.ts"])).not.toBe(fingerprint);
    expect(assetsReady(root, sourceFingerprint(root, ["source.ts"]))).toBe(false);
    expect(sourceFingerprint(root, [])).not.toBe(fingerprint);
    expect(sourceFingerprint(root, ["source.ts"], "different runtime")).not.toBe(sourceFingerprint(root, ["source.ts"]));
    rmSync(join(root, "dist/.build/index.html"));
    expect(assetsReady(root, fingerprint)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the ordinary Bun start command accepts --version without building assets or calling an LLM", () => {
  const proc = Bun.spawnSync([process.execPath, "run", "start", "--", "--version"], { stdout: "pipe", stderr: "pipe" });
  expect(proc.exitCode).toBe(0);
  expect(new TextDecoder().decode(proc.stdout)).toMatch(/^mitori 0\.0\.0(\+[0-9a-f]{12})? \(api 1\)\n$/);
});

test("start passes the source build id to its children through the env", async () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-bid-"));
  const saved = process.env[BUILD_ENV];
  try {
    writeFileSync(join(root, "a.ts"), "one");
    const first = exportBuildId(root, ["a.ts"], "runtime-1");
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(process.env[BUILD_ENV]).toBe(first);
    const { cliVersion } = await import("../apps/cli/src/main.ts");
    expect(cliVersion()).toBe(`0.0.0+${first}`);
    writeFileSync(join(root, "a.ts"), "two");
    expect(exportBuildId(root, ["a.ts"], "runtime-1")).not.toBe(first);
  } finally {
    if (saved === undefined) delete process.env[BUILD_ENV];
    else process.env[BUILD_ENV] = saved;
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollover lists $BUN_INSTALL, ~/.bun, then PATH buns without duplicates or self", () => {
  expect(
    listBunCandidates({
      bunInstall: "/opt/bun",
      home: "/Users/x",
      pathValue: ["/opt/bun/bin", "/usr/local/bin", "/old/dir"].join(delimiter),
      execPath: "/old/dir/bun",
    }),
  ).toEqual(["/opt/bun/bin/bun", "/Users/x/.bun/bin/bun", "/usr/local/bin/bun"]);
  expect(listBunCandidates({ execPath: "/old/bun" })).toEqual([]);
  expect(listBunCandidates({ bunInstall: "", home: "", pathValue: "", execPath: "/old/bun" })).toEqual([]);
});

test("rollover reports the handoff as a single stderr line", () => {
  expect(rolloverNotice("1.3.13", "/Users/x/.bun/bin/bun", "1.4.2")).toBe("mitori: Bun 1.3.13 is too old; using /Users/x/.bun/bin/bun 1.4.2\n");
});

test("rollover re-execs with the first supported Bun, forwarding args, exit code, and npm_execpath", () => {
  const calls: { command: string; args: string[]; env: Record<string, string> }[] = [];
  const notices: string[] = [];
  const code = attemptBunRollover(["setup", "muse", "--effort", "high"], {
    version: "1.3.13",
    execPath: "/old/bun",
    env: { BUN_INSTALL: "/fake/bun-install", PATH: "/fake/path/bin", npm_execpath: "/old/bun" },
    homeDir: "/fake/home",
    startScript: "/repo/scripts/start.ts",
    probe: (command) => (command === "/fake/bun-install/bin/bun" ? "1.3.13" : command === "/fake/home/.bun/bin/bun" ? "1.4.2" : undefined),
    runChild: (command, args, env) => {
      calls.push({ command, args: [...args], env });
      return 42;
    },
    onNotice: (line) => notices.push(line),
  });
  expect(code).toBe(42);
  expect(notices).toEqual(["mitori: Bun 1.3.13 is too old; using /fake/home/.bun/bin/bun 1.4.2\n"]);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.command).toBe("/fake/home/.bun/bin/bun");
  expect(calls[0]?.args).toEqual(["/repo/scripts/start.ts", "setup", "muse", "--effort", "high"]);
  expect(calls[0]?.env.npm_execpath).toBe("/fake/home/.bun/bin/bun");
  expect(calls[0]?.env[BUN_ROLLOVER_GUARD]).toBe("1");
});

test("rollover probes candidates with --version and skips old or broken ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "mitori-rollover-"));
  try {
    const oldBin = join(dir, "old");
    const newBin = join(dir, "new");
    mkdirSync(oldBin);
    mkdirSync(newBin);
    writeFileSync(join(oldBin, "bun"), "#!/bin/sh\necho 1.3.13\n");
    writeFileSync(join(newBin, "bun"), "#!/bin/sh\necho 1.4.2\n");
    chmodSync(join(oldBin, "bun"), 0o755);
    chmodSync(join(newBin, "bun"), 0o755);
    const calls: string[] = [];
    const code = attemptBunRollover(["--version"], {
      version: "1.3.13",
      execPath: join(dir, "self", "bun"),
      env: { PATH: [oldBin, join(dir, "missing"), newBin].join(delimiter) },
      homeDir: join(dir, "nohome"),
      nixFound: false,
      startScript: join(dir, "start.ts"),
      onNotice: () => {},
      runChild: (command) => {
        calls.push(command);
        return 7;
      },
    });
    expect(code).toBe(7);
    expect(calls).toEqual([join(newBin, "bun")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rollover never re-execs twice once the guard is set", () => {
  let probes = 0;
  const code = attemptBunRollover(["--version"], {
    version: "1.3.13",
    execPath: "/old/bun",
    env: { PATH: "/fake/path/bin", [BUN_ROLLOVER_GUARD]: "1" },
    homeDir: "/fake/home",
    probe: () => {
      probes++;
      return "1.4.2";
    },
    runChild: () => 0,
  });
  expect(code).toBeUndefined();
  expect(probes).toBe(0);
});

test("rollover falls back to scripts/nd when no direct Bun qualifies and leaves npm_execpath alone", () => {
  const ndScript = join(ROOT, "scripts/nd");
  const notices: string[] = [];
  const calls: { command: string; args: string[]; env: Record<string, string> }[] = [];
  const code = attemptBunRollover(["setup", "muse"], {
    version: "1.3.13",
    execPath: "/old/bun",
    env: { PATH: "/nonexistent-xyz", npm_execpath: "/old/bun" },
    homeDir: "/nonexistent-home-xyz",
    nixFound: true,
    ndScript,
    startScript: "/repo/scripts/start.ts",
    probe: (command) => (command === ndScript ? "1.4.2" : undefined),
    runChild: (command, args, env) => {
      calls.push({ command, args: [...args], env });
      return 3;
    },
    onNotice: (line) => notices.push(line),
  });
  expect(code).toBe(3);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.command).toBe(ndScript);
  expect(calls[0]?.args).toEqual(["bun", "/repo/scripts/start.ts", "setup", "muse"]);
  expect(calls[0]?.env.npm_execpath).toBe("/old/bun");
  expect(calls[0]?.env[BUN_ROLLOVER_GUARD]).toBe("1");
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("is too old; using ");
});

test("startup keeps the historical error when no newer Bun exists", async () => {
  const err: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await start(["--version"], {
      version: "1.3.13",
      execPath: "/old/bun",
      env: { PATH: "/nonexistent-xyz" },
      homeDir: "/nonexistent-home-xyz",
      nixFound: false,
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain("or newer is required; selected");
  } finally {
    process.stderr.write = original;
  }
});
