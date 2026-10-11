/** Native Windows: the distributed CLI starts its embedded daemon, owns cold-export cleanup, and preserves an existing daemon. */
import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { probeDaemon } from "@mitori/client";
import { pidAlive, readRegistry } from "./daemon-client.ts";

interface Fixture {
  dir: string;
  repo: string;
  home: string;
  binary: string;
  env: Record<string, string>;
}

/** Bound pipe draining too: a detached daemon must not retain its parent's stdout/stderr handles. */
async function command(f: Fixture, executable: string, args: string[]) {
  const child = Bun.spawn([executable, ...args], { cwd: f.repo, env: f.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [code, out, err] = await Promise.race([
      Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Windows bootstrap command timed out: ${args[0]}`)), 30_000);
      }),
    ]);
    if (code !== 0) throw new Error(`Windows bootstrap command failed (${code}): ${args[0]}\n${out}\n${err}`);
    return out;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (child.exitCode === null) child.kill(); // Only this test's direct child.
  }
}

async function verifiedRegistry(home: string) {
  const reg = readRegistry(home);
  if (!reg || !pidAlive(reg.pid)) return null;
  const health = await probeDaemon({
    origin: `http://127.0.0.1:${reg.port}`,
    token: reg.token,
    challenge: crypto.getRandomValues(new Uint8Array(16)),
    timeoutMs: 1500,
  });
  return health?.pid === reg.pid ? reg : null;
}

async function cleanup(f: Fixture) {
  // Only act on the private registry after a token proof and PID match; never stop another user's daemon.
  const own = await verifiedRegistry(f.home);
  if (own) {
    try {
      await command(f, f.binary, ["stop"]);
    } catch {
      // A failed assertion/command must still clean up this test's authenticated daemon.
    }
    if ((await verifiedRegistry(f.home))?.pid === own.pid) process.kill(own.pid, "SIGTERM");
    const until = Date.now() + 5000;
    while (pidAlive(own.pid) && Date.now() < until) await Bun.sleep(25);
  }
  const left = readRegistry(f.home);
  if (left && pidAlive(left.pid)) throw new Error("Windows bootstrap fixture still has a live daemon");
  rmSync(f.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

async function fixture(run: (f: Fixture) => Promise<void>, gitRepo = true) {
  const dir = mkdtempSync(join(tmpdir(), "mitori-win-bootstrap-"));
  const repo = join(dir, "repo");
  const home = join(dir, "state");
  const profile = join(dir, "profile");
  const hooks = join(dir, "empty-hooks");
  const temp = join(dir, "tmp");
  for (const path of [repo, home, profile, hooks, temp, join(repo, "src")]) mkdirSync(path, { recursive: true });
  writeFileSync(join(profile, ".gitconfig"), "");
  writeFileSync(join(repo, "README.md"), "# Native bootstrap fixture\n");
  writeFileSync(join(repo, "src", "a.ts"), "export function add(a: number, b: number) { return a + b; }\n");
  // The executable has no adjacent node_modules or external launcher. CLI children must use embedded assets.
  const binary = join(dir, "mitori.exe");
  copyFileSync(process.env.MITORI_BIN ?? resolve("dist/mitori-windows-x64.exe"), binary);
  const env: Record<string, string> = {
    HOME: profile,
    USERPROFILE: profile,
    MITORI_HOME: home,
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    GIT_CONFIG_GLOBAL: join(profile, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // In particular, never forward the test runner's BUN_BE_BUN or MITORI_WINDOWS_JOB_LAUNCHER.
  const f = { dir, repo, home, binary, env };
  try {
    if (gitRepo) {
      const git = ["-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"];
      await command(f, "git", [...git, "-c", "init.templateDir=", "init", "--quiet"]);
      await command(f, "git", [...git, "add", "."]);
      await command(f, "git", [...git, "commit", "--quiet", "-m", "fixture"]);
    }
    await run(f);
  } finally {
    await cleanup(f);
  }
}

function expectHtml(path: string) {
  const html = readFileSync(path, "utf8");
  expect(html.toLowerCase()).toContain("<!doctype html>");
  expect(html).toContain('id="mitori-export"');
}

describe.skipIf(process.platform !== "win32")("compiled Windows client bootstrap (no LLM)", () => {
  for (const gitRepo of [true, false]) {
    test(`cold ${gitRepo ? "Git" : "shadow"} export starts its own daemon, writes HTML, and removes its registry`, async () => {
      await fixture(async (f) => {
        expect(existsSync(join(f.home, "daemon.json"))).toBe(false);
        const out = join(f.repo, "own.html");
        expect((await command(f, f.binary, ["export", "--html", "--no-code", "-o", out])).trim().length).toBeGreaterThan(0);
        expectHtml(out);
        expect(existsSync(join(f.home, "daemon.json"))).toBe(false);
      }, gitRepo);
    }, 120_000);
  }

  test("scan's daemon survives the CLI exit, is reused by export, and stops explicitly", async () => {
    await fixture(async (f) => {
      await command(f, f.binary, ["scan"]);
      const before = await verifiedRegistry(f.home);
      if (!before) throw new Error("The compiled scan's daemon did not survive its parent CLI");
      const out = join(f.repo, "existing.html");
      await command(f, f.binary, ["export", "--html", "--no-code", "-o", out]);
      expectHtml(out);
      const after = await verifiedRegistry(f.home);
      expect(after?.pid).toBe(before.pid);
      expect(after?.token === before.token).toBe(true); // Do not print the registry token on failure.
      expect(after?.startedAt).toBe(before.startedAt);
      await command(f, f.binary, ["stop"]);
      expect(existsSync(join(f.home, "daemon.json"))).toBe(false);
    });
  }, 120_000);
});
