import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsReader, createSafeWriter, createSpawner, systemClock } from "@mitori/platform";
import { ANTIGRAVITY_AGENT } from "../adapters/antigravity-policy.ts";
import { resolveOnSafePath } from "../claude/resolve.ts";
import { createFakeSpawner, createTestBridge } from "../testing.ts";
import { timersFor } from "../util/timers.ts";
import { selectLnCommand } from "./assemble.ts";

const HELP = "--input-format --output-format --model --agent --disable-slash-commands -p, --print";

function baseSpawner(lnImpl: (spec: { argv: readonly string[] }) => boolean, lnChild: { stdout?: string[]; stderr?: string[]; exitCode?: number }) {
  return createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low"] })
    .script((s) => s.argv[0] === "--help", { stdout: [HELP] })
    .script(lnImpl, lnChild);
}

test("WP40e-1 antigravity isolation runs ln via its PATH entry, not its multicall realpath", async () => {
  const spawner = baseSpawner((s) => s.argv[0] === "-s", { stdout: [] });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/nix/store/hash-coreutils-9.11/bin/coreutils", new TextEncoder().encode("coreutils"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  // Nix coreutils: /usr/bin/ln resolves to a multicall binary whose basename is not `ln`.
  const origRealpath = b.fs.fs.realpath;
  b.fs.fs.realpath = (abs) => (abs === "/usr/bin/ln" ? "/nix/store/hash-coreutils-9.11/bin/coreutils" : origRealpath(abs));
  const st = await b.engines["antigravity-cli"]!.detect();
  expect(st.problems).toEqual([]);
  const lnCall = spawner.calls.find((c) => c.argv[0] === "-s");
  expect(lnCall?.command).toBe("/usr/bin/ln");
});

test("WP40e-2 antigravity isolation link failure names the ln exit code and stderr head", async () => {
  const spawner = baseSpawner((s) => s.argv[0] === "-s", { stdout: [], stderr: ["ln: failed to create symbolic link: permission denied"], exitCode: 1 });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const st = await b.engines["antigravity-cli"]!.detect();
  expect(st.problems).toHaveLength(1);
  expect(st.problems[0]?.code).toBe("E_PRECONDITION");
  expect(st.problems[0]?.message).toContain("1");
  expect(st.problems[0]?.message).toContain("permission denied");
});

test("WP40e-3 antigravity isolation links Library/Keychains with the real ln and removes the root on cleanup", async () => {
  const fs = createFsReader();
  const safeWrite = createSafeWriter();
  const spawner = createSpawner();
  const timers = timersFor(systemClock);
  const daemonHome = realpathSync(mkdtempSync(join(tmpdir(), "mitori-agy-home-")));
  const userHome = realpathSync(mkdtempSync(join(tmpdir(), "mitori-agy-user-")));
  try {
    mkdirSync(join(userHome, "Library/Keychains"), { recursive: true });
    writeFileSync(join(userHome, "Library/Keychains", "login.keychain-db"), "test-keychain");
    const id = `test-${Date.now().toString(36)}`;
    const rel = `run/antigravity/${id}`;
    const root = join(daemonHome, rel);
    await safeWrite.write(daemonHome, `${rel}/work/.agents/agents/${ANTIGRAVITY_AGENT}.md`, "test-agent", "home");
    await safeWrite.write(daemonHome, `${rel}/home/Library/.mitori-keep`, "", "home");
    await safeWrite.remove(daemonHome, `${rel}/home/Library/.mitori-keep`, "home");
    const source = join(userHome, "Library/Keychains");
    const link = join(root, "home/Library/Keychains");
    const safePath = "/usr/bin:/bin";
    const ln = resolveOnSafePath(fs, safePath, "ln");
    expect(ln).not.toBeNull();
    const command = selectLnCommand(fs, ln!);
    const child = spawner.spawn({
      command,
      argv: ["-s", fs.realpath(source) ?? source, link],
      env: { PATH: safePath },
      cwd: "/",
      stdin: "",
      keepStdinOpen: false,
      timeoutMs: 10_000,
      processGroup: true,
    });
    child.closeStdin();
    const kill = timers.set(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // gone
      }
    }, 10_000);
    const errLines: string[] = [];
    const drainOut = (async () => {
      for await (const _ of child.stdout) {
        // `ln -s` prints nothing on success
      }
    })();
    const drainErr = (async () => {
      for await (const line of child.stderr) errLines.push(line);
    })();
    const code = await child.exited;
    await Promise.allSettled([drainOut, drainErr]);
    timers.clear(kill);
    expect(`${code} ${errLines.join("\n")}`).toBe("0 ");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(fs.realpath(source) ?? source);
    expect(lstatSync(join(root, "home/Library")).isDirectory()).toBe(true);
    await safeWrite.remove(daemonHome, rel, "home");
    expect(existsSync(root)).toBe(false);
  } finally {
    rmSync(daemonHome, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
  }
});
