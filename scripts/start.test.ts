import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { BUILD_ENV } from "./lib/build-id.ts";
import { ROOT } from "./lib/repo.ts";
import {
  assetsReady,
  attemptBunRollover,
  BUN_ROLLOVER_GUARD,
  DEPS_REEXEC_GUARD,
  depsReady,
  ensureDependencies,
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

test("startup installs dependencies once on the first run and records the lockfile hash", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-deps-"));
  try {
    writeFileSync(join(root, "bun.lock"), "first lockfile");
    expect(depsReady(root)).toBe(false);
    const calls: { command: string; args: string[]; cwd: string }[] = [];
    const notices: string[] = [];
    ensureDependencies(root, [], {
      execPath: "/fake/bun",
      spawnInstall: (command, args, cwd) => {
        calls.push({ command, args: [...args], cwd });
        return 0;
      },
      runChild: () => 0,
      onNotice: (line) => notices.push(line),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/fake/bun");
    expect(calls[0]?.args).toEqual(["install", "--frozen-lockfile"]);
    expect(calls[0]?.cwd).toBe(root);
    expect(notices).toEqual(["mitori: installing dependencies (first run or updated bun.lock)…\n"]);
    const expected = createHash("sha256")
      .update(readFileSync(join(root, "bun.lock")))
      .digest("hex");
    expect(readFileSync(join(root, "node_modules/.mitori-deps"), "utf8")).toBe(expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup reinstalls dependencies when bun.lock changed after the last install", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-deps-"));
  try {
    writeFileSync(join(root, "bun.lock"), "new lockfile");
    mkdirSync(join(root, "node_modules/vite"), { recursive: true });
    writeFileSync(join(root, "node_modules/vite/package.json"), "{}");
    writeFileSync(join(root, "node_modules/.mitori-deps"), "outdated stamp");
    expect(depsReady(root)).toBe(false);
    let calls = 0;
    ensureDependencies(root, [], {
      execPath: "/fake/bun",
      spawnInstall: () => {
        calls++;
        return 0;
      },
      runChild: () => 0,
      onNotice: () => {},
    });
    expect(calls).toBe(1);
    const expected = createHash("sha256")
      .update(readFileSync(join(root, "bun.lock")))
      .digest("hex");
    expect(readFileSync(join(root, "node_modules/.mitori-deps"), "utf8")).toBe(expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup skips the install when the lockfile hash matches the stamp", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-deps-"));
  try {
    writeFileSync(join(root, "bun.lock"), "steady lockfile");
    mkdirSync(join(root, "node_modules/vite"), { recursive: true });
    writeFileSync(join(root, "node_modules/vite/package.json"), "{}");
    const stamp = createHash("sha256")
      .update(readFileSync(join(root, "bun.lock")))
      .digest("hex");
    writeFileSync(join(root, "node_modules/.mitori-deps"), stamp);
    expect(depsReady(root)).toBe(true);
    let calls = 0;
    ensureDependencies(root, [], {
      execPath: "/fake/bun",
      spawnInstall: () => {
        calls++;
        return 0;
      },
      onNotice: () => {},
    });
    expect(calls).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup keeps no stamp and tells the manual command when the install fails", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-deps-"));
  try {
    writeFileSync(join(root, "bun.lock"), "lockfile");
    let calls = 0;
    expect(() =>
      ensureDependencies(root, [], {
        execPath: "/fake/bun",
        spawnInstall: () => {
          calls++;
          return 3;
        },
        onNotice: () => {},
      }),
    ).toThrow("'/fake/bun' install --frozen-lockfile");
    expect(calls).toBe(1);
    expect(existsSync(join(root, "node_modules/.mitori-deps"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup re-execs with the same Bun and args once right after a successful install", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-deps-"));
  try {
    writeFileSync(join(root, "bun.lock"), "fresh clone lockfile");
    expect(depsReady(root)).toBe(false);
    const installs: { command: string; args: string[]; cwd: string }[] = [];
    const children: { command: string; args: string[]; env: Record<string, string> }[] = [];
    const code = ensureDependencies(root, ["setup", "muse", "--print"], {
      execPath: "/fake/bun",
      env: { PATH: "/usr/bin:/bin" },
      startScript: "/repo/scripts/start.ts",
      spawnInstall: (command, args, cwd) => {
        installs.push({ command, args: [...args], cwd });
        return 0;
      },
      runChild: (command, args, env) => {
        children.push({ command, args: [...args], env });
        return 77;
      },
      onNotice: () => {},
    });
    expect(code).toBe(77);
    expect(installs).toEqual([{ command: "/fake/bun", args: ["install", "--frozen-lockfile"], cwd: root }]);
    const expected = createHash("sha256")
      .update(readFileSync(join(root, "bun.lock")))
      .digest("hex");
    expect(readFileSync(join(root, "node_modules/.mitori-deps"), "utf8")).toBe(expected);
    expect(children).toHaveLength(1);
    expect(children[0]?.command).toBe("/fake/bun");
    expect(children[0]?.args).toEqual(["/repo/scripts/start.ts", "setup", "muse", "--print"]);
    expect(children[0]?.env[DEPS_REEXEC_GUARD]).toBe("1");
    expect("npm_execpath" in (children[0]?.env ?? {})).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup refuses a second install once the deps re-exec guard is set", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-deps-"));
  try {
    writeFileSync(join(root, "bun.lock"), "lockfile");
    expect(depsReady(root)).toBe(false);
    let installs = 0;
    let children = 0;
    expect(() =>
      ensureDependencies(root, ["setup", "muse"], {
        execPath: "/fake/bun",
        env: { [DEPS_REEXEC_GUARD]: "1" },
        spawnInstall: () => {
          installs++;
          return 0;
        },
        runChild: () => {
          children++;
          return 0;
        },
        onNotice: () => {},
      }),
    ).toThrow("'/fake/bun' install --frozen-lockfile");
    expect(installs).toBe(0);
    expect(children).toBe(0);
    expect(existsSync(join(root, "node_modules/.mitori-deps"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup does not re-exec when dependencies are already current", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-deps-"));
  try {
    writeFileSync(join(root, "bun.lock"), "steady lockfile");
    mkdirSync(join(root, "node_modules/vite"), { recursive: true });
    writeFileSync(join(root, "node_modules/vite/package.json"), "{}");
    writeFileSync(
      join(root, "node_modules/.mitori-deps"),
      createHash("sha256")
        .update(readFileSync(join(root, "bun.lock")))
        .digest("hex"),
    );
    expect(depsReady(root)).toBe(true);
    let installs = 0;
    let children = 0;
    const code = ensureDependencies(root, ["setup", "muse"], {
      execPath: "/fake/bun",
      env: {},
      spawnInstall: () => {
        installs++;
        return 0;
      },
      runChild: () => {
        children++;
        return 0;
      },
      onNotice: () => {},
    });
    expect(code).toBeUndefined();
    expect(installs).toBe(0);
    expect(children).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
