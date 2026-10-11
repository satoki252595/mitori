import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationSetup } from "./setup-integrations.ts";

test("printed source MCP configuration initializes from a foreign cwd with an explicit workspace", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "mitori repo ' $ "));
  try {
    for (const target of ["cursor", "antigravity"] as const) {
      const text = integrationSetup(target, { command: process.execPath, args: [join(import.meta.dir, "../main.ts")], workspace });
      const config = JSON.parse(/\n(\{[\s\S]*\})\n\n/.exec(text)?.[1] ?? "") as { mcpServers: { mitori: { command: string; args: string[] } } };
      const { command, args } = config.mcpServers.mitori;
      const child = Bun.spawn([command, ...args], { cwd: tmpdir(), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } })}\n`);
      child.stdin.end();
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).result.serverInfo.name).toBe("mitori");
      expect(args.slice(-3)).toEqual(["mcp", "--repo", workspace]);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("native registration commands and Codex TOML preserve paths containing shell syntax", async () => {
  const command = "/opt/my app/it's $(printf BAD)";
  const workspace = "/repo/a b; echo 'hi'";
  const text = integrationSetup("codex", { command, args: [], workspace });
  const toml = text.slice(text.indexOf("[mcp_servers.mitori]"), text.indexOf("\n\nCodex に依頼"));
  const parsed = Bun.TOML.parse(toml) as { mcp_servers: { mitori: { command: string; args: string[] } } };
  expect(parsed.mcp_servers.mitori).toEqual({ command, args: ["mcp", "--repo", workspace] });
  for (const [target, cli] of [
    ["codex", "codex"],
    ["antigravity", "agy"],
    ["grok", "grok"],
  ] as const) {
    const setup = integrationSetup(target, { command, args: [], workspace });
    const prefix = target === "grok" ? `${cli} ` : `${cli} mcp add mitori -- `;
    const words =
      setup
        .split("\n")
        .find((line) => line.startsWith(prefix))
        ?.slice(prefix.length) ?? "";
    const child = Bun.spawn(["/bin/sh", "-c", `set -- ${words}; printf '%s\\0' "$@"`], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.split("\0").slice(0, -1)).toEqual([
      ...(target === "grok" ? ["--cwd", workspace, "mcp", "add", "mitori", "--scope", "project", "--"] : []),
      command,
      "mcp",
      "--repo",
      workspace,
    ]);
  }
});
