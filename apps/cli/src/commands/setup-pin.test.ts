import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHasher } from "@mitori/platform";
import { prepareClaudePin } from "./setup-pin.ts";
import { testIo } from "./test/fake-daemon.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fake(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "mitori-pin-"));
  dirs.push(dir);
  const binary = join(dir, "claude");
  writeFileSync(binary, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  const io = testIo({ argv: [], home: dir, cwd: dir, env: { ANTHROPIC_API_KEY: "never-pass-or-log", CLAUDE_CODE_OAUTH_TOKEN: "never-pass-or-log" } });
  return { binary, io };
}

test("Claude setup pins the reviewed file and version without repo cwd, auth, or credentials", async () => {
  const { binary, io } = fake(`
if (JSON.stringify(process.argv.slice(2)) !== '["--version"]' || process.cwd() !== "/" || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) process.exit(1);
console.log("2.1.288 (Claude Code)");`);
  const pin = await prepareClaudePin(binary, io);
  expect(pin).toMatchObject({ path: binary, realpath: realpathSync(binary), version: "2.1.288 (Claude Code)", by: "user" });
  expect(pin.sha256).toBe(createHasher().sha256(readFileSync(binary)));
  expect(Date.parse(pin.pinnedAt)).not.toBeNaN();
  expect(io.stdout + io.stderr + JSON.stringify(pin)).not.toContain("never-pass-or-log");
});

test("Claude setup rejects replacement during the version probe and bounded-output failures", async () => {
  const replacement = fake(`await Bun.write(process.argv[1], "replacement"); console.log("2.1.288 (Claude Code)");`);
  await expect(prepareClaudePin(replacement.binary, replacement.io)).rejects.toThrow("changed during verification");
  const large = fake(`process.stdout.write("x".repeat(8192));`);
  await expect(prepareClaudePin(large.binary, large.io)).rejects.toThrow("too much output");
  const failed = fake(`console.error("sensitive account details"); process.exit(1);`);
  await expect(prepareClaudePin(failed.binary, failed.io)).rejects.toThrow("claude --version failed");
  expect(failed.io.stdout + failed.io.stderr).not.toContain("sensitive account details");
});

test("Claude setup terminates a hanging version probe", async () => {
  const { binary, io } = fake("setInterval(() => {}, 1000);");
  await expect(prepareClaudePin(binary, io)).rejects.toThrow("timed out");
}, 10_000);
