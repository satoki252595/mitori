/**
 * The commands through the real entry (`bun apps/cli/src/main.ts …`, as the binary runs them): TTY refusals exit 2
 * under CLAUDECODE=1 (WP-11 acceptance), `touch --stdin` prints zero bytes without a daemon, `mcp` answers
 * `initialize` from a cold process, and CLI-G-001 the `--help` text of every command (ja / en golden).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectGolden } from "@mitori/testkit";
import { COMMAND_NAMES, runCommand } from "./index.ts";
import { testIo } from "./test/fake-daemon.ts";

const MAIN = join(import.meta.dir, "../main.ts");
let dir = "";
let home = "";
let repo = "";
beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "mitori-cli-int-")));
  home = join(dir, "home");
  repo = join(dir, "repo");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(join(repo, ".git"), { recursive: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const env = (extra: Record<string, string> = {}) => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, MITORI_HOME: home, LANG: "C.UTF-8", ...extra });

function run(args: string[], o: { env?: Record<string, string>; stdin?: string } = {}) {
  const r = Bun.spawnSync(["bun", MAIN, ...args], {
    cwd: repo,
    env: env(o.env),
    stdin: o.stdin === undefined ? "ignore" : Buffer.from(o.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

describe("through main.ts", () => {
  test("CLAUDECODE=1: gen, init --commit, install --force exit 2 with E_TTY_REQUIRED", () => {
    for (const args of [["gen"], ["init", "--commit"], ["install", "claude-code", "--force"]]) {
      const r = run(args, { env: { CLAUDECODE: "1" } });
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
      expect(r.stderr).toMatch(/^error E_TTY_REQUIRED: /);
      expect(r.stdout).toBe("");
    }
  });

  test("touch --stdin without a daemon: exit 0, no output at all", () => {
    const r = run(["touch", "--stdin", "--source", "claude-hook"], { stdin: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: `${repo}/a.ts` } }) });
    expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("mcp answers initialize from a cold process before any daemon exists", async () => {
    const p = Bun.spawn(["bun", MAIN, "mcp"], { cwd: repo, env: env(), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const t0 = performance.now();
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", clientInfo: { name: "t" } } })}\n`);
    await p.stdin.flush();
    const reader = p.stdout.getReader();
    let out = "";
    while (!out.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    const ms = performance.now() - t0;
    p.stdin.end();
    expect(await p.exited).toBe(0);
    expect(JSON.parse(out.split("\n")[0] ?? "{}").result.serverInfo).toEqual({ name: "mitori", version: expect.any(String) });
    expect(ms).toBeLessThan(2000); // source mode (bun transpiles); the compiled binary is measured against mcp.init 60 ms
  });

  test("unknown subcommands are paths; usage errors exit 2", () => {
    expect(run(["review", "--round", "x"]).code).toBe(2);
    expect(run(["bundle"]).code).toBe(2);
  });
});

describe("CLI-G-001 --help of every command", () => {
  for (const lang of ["ja", "en"] as const)
    test(lang, async () => {
      let all = "";
      for (const name of COMMAND_NAMES) {
        const t = testIo({ argv: ["--help"], home, cwd: repo, env: { LANG: lang === "ja" ? "ja_JP.UTF-8" : "en_US.UTF-8" } });
        expect(await runCommand(name, t)).toBe(0);
        expect(t.stdout.startsWith(`mitori ${name}`)).toBe(true);
        all += `## ${name}\n${t.stdout}\n`;
      }
      expectGolden(`cli/help.${lang}.txt`, all);
    });
});
