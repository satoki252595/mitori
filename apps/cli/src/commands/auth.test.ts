import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAuthId } from "@mitori/core";
import { type AuthDeps, type AuthSpawn, runWith } from "./auth.ts";
import { runCommand } from "./index.ts";
import { testIo } from "./test/fake-daemon.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(provider: ProviderAuthId = "claude") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mitori-auth-test-")));
  dirs.push(dir);
  const repo = join(dir, "repo");
  mkdirSync(repo);
  const name = provider === "muse" ? "muse-bin-1.2.3" : provider === "cursor" ? "cursor-agent" : provider === "grok" ? "grok-1.0.46-macos-aarch64" : provider;
  const binary = join(dir, name);
  writeFileSync(binary, "fixture executable; never run", { mode: 0o700 });
  const io = testIo({
    argv: [provider, "--binary", binary],
    home: dir,
    cwd: repo,
    tty: true,
    answer: true,
    env: {
      HOME: dir,
      PATH: `${repo}/node_modules/.bin:/usr/bin:.:/bin`,
      ANTHROPIC_API_KEY: "secret-api",
      CLAUDE_CODE_OAUTH_TOKEN: "secret-oauth",
      XAI_API_KEY: "secret-grok",
      OLLAMA_HOST: "https://remote.invalid",
      NODE_OPTIONS: "--require attacker.js",
      BROWSER: "attacker --token secret",
      CLAUDE_CONFIG_DIR: repo,
      CODEX_HOME: repo,
    },
  });
  const calls: AuthSpawn[] = [];
  const deps: AuthDeps = {
    which() {
      throw new Error("explicit binaries do not search PATH");
    },
    async spawn(spec) {
      calls.push(spec);
      return 0;
    },
  };
  return { dir, repo, binary, io, deps, calls };
}

test("official login-only argv inherit the human terminal and scrub credentials and unrelated configuration", async () => {
  const commands: [ProviderAuthId, string[]][] = [
    ["claude", ["auth", "login"]],
    ["muse", ["login"]],
    ["codex", ["login"]],
    ["cursor", ["login"]],
    ["grok", ["login", "--oauth"]],
    ["ollama", ["signin"]],
  ];
  for (const [provider, args] of commands) {
    const f = fixture(provider);
    let confirms = 0;
    f.io.confirm = async () => {
      confirms++;
      expect(f.calls).toHaveLength(0);
      expect(f.io.stdout).toContain(createHash("sha256").update(readFileSync(f.binary)).digest("hex"));
      return true;
    };
    expect(await runWith(f.io, f.deps)).toBe(0);
    expect(confirms).toBe(1);
    expect(f.calls).toHaveLength(provider === "muse" ? 2 : 1);
    const call = f.calls.at(-1);
    expect(call).toMatchObject({ cmd: [f.binary, ...args], stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    expect(call?.env).toEqual({
      HOME: f.dir,
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      ...(provider === "claude" ? { CLAUDE_CONFIG_DIR: f.repo } : {}),
      ...(provider === "codex" ? { CODEX_HOME: f.repo } : {}),
      ...(provider === "ollama" ? { OLLAMA_HOST: "http://127.0.0.1:11434" } : {}),
    });
    expect(f.io.stdout + f.io.stderr).not.toContain("secret-");
    expect(f.io.spawned).toHaveLength(0);
    expect(f.io.stdout).not.toContain("ログイン済み");
  }
});

test("matching native auth directories are reviewed and reused; malformed directories are rejected before sign-in", async () => {
  const f = fixture("muse");
  f.io.env = { ...f.io.env, XDG_CONFIG_HOME: join(f.dir, "existing-native-config") };
  expect(await runWith(f.io, f.deps)).toBe(0);
  expect(f.calls[0]?.env.XDG_CONFIG_HOME).toBe(join(f.dir, "existing-native-config"));
  expect(f.calls[0]?.env).not.toHaveProperty("CODEX_HOME");
  expect(f.calls[0]?.env).not.toHaveProperty("CLAUDE_CONFIG_DIR");
  expect(f.io.stdout).toContain(`XDG_CONFIG_HOME: ${join(f.dir, "existing-native-config")}`);
  for (const value of ["./repo-config", "/config\nspoofed-confirmation"]) {
    const bad = fixture();
    bad.io.env = { ...bad.io.env, CLAUDE_CONFIG_DIR: value };
    await expect(runWith(bad.io, bad.deps)).rejects.toThrow("absolute path without control characters");
    expect(bad.calls).toHaveLength(0);
  }
});

test("Muse reviews clearing saved API auth, then uses fixed logout/login and stops on failure or replacement", async () => {
  const f = fixture("muse");
  f.io.confirm = async () => {
    expect(f.io.stdout).toContain("保存済み API キーを logout で解除");
    expect(f.io.stdout).toContain("logout → login");
    expect(f.calls).toHaveLength(0);
    return true;
  };
  expect(await runWith(f.io, f.deps)).toBe(0);
  expect(f.calls.map((call) => call.cmd)).toEqual([
    [f.binary, "logout"],
    [f.binary, "login"],
  ]);

  const failed = fixture("muse");
  failed.deps.spawn = async (spec) => {
    failed.calls.push(spec);
    return 17;
  };
  expect(await runWith(failed.io, failed.deps)).toBe(17);
  expect(failed.calls.map((call) => call.cmd)).toEqual([[failed.binary, "logout"]]);

  const replaced = fixture("muse");
  replaced.deps.spawn = async (spec) => {
    replaced.calls.push(spec);
    writeFileSync(replaced.binary, "replacement after logout", { mode: 0o700 });
    return 0;
  };
  await expect(runWith(replaced.io, replaced.deps)).rejects.toThrow("changed after confirmation");
  expect(replaced.calls.map((call) => call.cmd)).toEqual([[replaced.binary, "logout"]]);
});

test("non-TTY and agent invocations refuse before looking up or reading any executable", async () => {
  const f = fixture();
  f.io.argv = ["claude", "--binary", "/does-not-exist"];
  f.io.confirm = async () => {
    throw new Error("must not ask an agent");
  };
  f.io.isTTY = false;
  await expect(runWith(f.io, f.deps)).rejects.toThrow("needs a human confirmation");
  f.io.isTTY = true;
  f.io.env = { ...f.io.env, CLAUDECODE: "1" };
  await expect(runWith(f.io, f.deps)).rejects.toThrow("agents cannot confirm");
  expect(f.calls).toHaveLength(0);
});

test("declining or replacing the reviewed executable never starts sign-in", async () => {
  const declined = fixture();
  declined.io.confirm = async () => false;
  expect(await runWith(declined.io, declined.deps)).toBe(1);
  expect(declined.calls).toHaveLength(0);
  const replaced = fixture();
  replaced.io.confirm = async () => {
    writeFileSync(replaced.binary, "replacement executable", { mode: 0o700 });
    return true;
  };
  await expect(runWith(replaced.io, replaced.deps)).rejects.toThrow("changed after confirmation");
  expect(replaced.calls).toHaveLength(0);
});

test("control characters in a selected executable or its symlink target cannot spoof the review", async () => {
  const f = fixture("codex");
  const spoof = join(f.dir, "codex\nSHA-256: trusted");
  writeFileSync(spoof, "spoofed executable", { mode: 0o700 });
  f.io.argv = ["codex", "--binary", spoof];
  await expect(runWith(f.io, f.deps)).rejects.toThrow("without control characters");
  const alias = join(f.dir, "codex-alias");
  symlinkSync(spoof, alias);
  f.io.argv = ["codex", "--binary", alias];
  await expect(runWith(f.io, f.deps)).rejects.toThrow("selected official executable");
  expect(f.io.stdout).toBe("");
  expect(f.calls).toHaveLength(0);
});

test("Muse resolves its native marker, Grok avoids ambiguous PATH agent, and Cursor rejects agent aliases", async () => {
  const muse = fixture("muse");
  const wrapper = join(muse.dir, "muse");
  writeFileSync(wrapper, "wrapper that must never execute", { mode: 0o700 });
  writeFileSync(join(muse.dir, ".muse-version"), "1.2.3");
  muse.io.argv = ["muse"];
  muse.deps.which = (name) => {
    expect(name).toBe("muse");
    return wrapper;
  };
  expect(await runWith(muse.io, muse.deps)).toBe(0);
  expect(muse.calls[0]?.cmd[0]).toBe(muse.binary);

  const grok = fixture("grok");
  const grokDir = join(grok.dir, ".grok/bin");
  mkdirSync(grokDir, { recursive: true });
  symlinkSync(grok.binary, join(grokDir, "agent"));
  grok.io.argv = ["grok"];
  expect(await runWith(grok.io, grok.deps)).toBe(0);
  expect(grok.calls[0]?.cmd).toEqual([grok.binary, "login", "--oauth"]);

  const cursor = fixture("cursor");
  const ambiguous = join(cursor.dir, "agent");
  writeFileSync(ambiguous, "unrelated agent", { mode: 0o700 });
  cursor.io.argv = ["cursor", "--binary", ambiguous];
  await expect(runWith(cursor.io, cursor.deps)).rejects.toThrow("official cursor-agent");
  cursor.io.argv = ["grok", "--binary", ambiguous];
  await expect(runWith(cursor.io, cursor.deps)).rejects.toThrow("known native grok-version");
  expect(cursor.calls).toHaveLength(0);
});

test("Antigravity only explains official app sign-in, and native failure is propagated without captured output", async () => {
  const app = fixture("antigravity");
  app.io.argv = ["antigravity"];
  expect(await runWith(app.io, app.deps)).toBe(0);
  expect(app.io.stdout).toContain("公式アプリ");
  expect(app.calls).toHaveLength(0);
  const failed = fixture();
  failed.deps.spawn = async () => 17;
  expect(await runWith(failed.io, failed.deps)).toBe(17);
  expect(failed.io.stdout).not.toContain("認証コマンドが終了");
  const help = fixture();
  help.io.argv = ["--help"];
  expect(await runCommand("auth", help.io)).toBe(0);
  expect(help.io.stdout).toContain("mitori auth <claude");
});
