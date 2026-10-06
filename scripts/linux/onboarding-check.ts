// Existing Docker verification only: no provider binaries, credentials, model calls or published UI port.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const base = mkdtempSync(join(tmpdir(), "mitori-onboarding-"));
const home = join(base, "home");
mkdirSync(home, { mode: 0o700 });
const env = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: home, MITORI_HOME: join(home, ".mitori"), LANG: "C.UTF-8" };
const report = {
  platform: `${process.platform}-${process.arch}`,
  bun: Bun.version,
  providerCalls: 0,
  credentialsMounted: false,
  previews: [] as { provider: string; result: "preview-only" | "missing-cli"; exit: number; ok: boolean }[],
  mcp: [] as { client: string; result: "stdio-handshake"; tools: number; ok: boolean }[],
  http: { result: "container-internal-only", health: false, ui: false, stopped: false },
  ok: false,
  error: "",
};
const run = (args: string[], input?: string) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["run", "start", "--", ...args], { cwd: process.cwd(), env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.end(input);
    const timeout = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });

try {
  const repo = process.cwd();
  const cases: [string, string[], "preview-only" | "missing-cli"][] = [
    ["claude", [], "missing-cli"],
    ["muse", [], "missing-cli"],
    ["codex", ["--repo", repo], "preview-only"],
    ["cursor", ["--repo", repo], "preview-only"],
    ["antigravity", ["--repo", repo], "preview-only"],
    ["grok", ["--repo", repo], "preview-only"],
    ["grok-api", ["--api"], "preview-only"],
    ["ollama", ["--model", "qwen3:8b"], "preview-only"],
    ["lmstudio", ["--model", "local-model"], "preview-only"],
    [
      "openai",
      ["--model", "custom-model", "--base-url", "https://provider.example/v1", "--key-env", "UNUSED_ONBOARDING_KEY", "--in-price", "2", "--out-price", "6"],
      "preview-only",
    ],
  ];
  for (const [name, args, result] of cases) {
    const provider = name === "grok-api" ? "grok" : name;
    const child = await run(["setup", provider, ...args, "--print"]);
    const expectedEngine = ["codex", "cursor", "antigravity", "grok"].includes(name) ? "session" : "generic";
    const ok =
      result === "missing-cli"
        ? child.status === 2 && child.stderr.includes(`${provider} is not on PATH`)
        : child.status === 0 && child.stdout.includes(`"defaultGenEngine": "${expectedEngine}"`);
    report.previews.push({ provider: name, result, exit: child.status ?? -1, ok });
    assert(ok, `setup ${name} did not return its expected preview/missing-CLI result`);
  }
  for (const client of ["codex", "cursor", "antigravity", "grok"]) {
    const input = `${[
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: client, version: "verification" } },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]
      .map((msg) => JSON.stringify(msg))
      .join("\n")}\n`;
    const child = await run(["mcp", "--repo", repo], input);
    assert.equal(child.status, 0, `MCP ${client} did not exit cleanly`);
    const messages = child.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const init = messages.find((msg) => msg.id === 1)?.result;
    const tools = messages.find((msg) => msg.id === 2)?.result?.tools;
    const ok = init?.serverInfo?.name === "mitori" && init.protocolVersion === "2025-06-18" && Array.isArray(tools) && tools.length > 0;
    report.mcp.push({ client, result: "stdio-handshake", tools: tools?.length ?? 0, ok });
    assert(ok, `MCP ${client} initialize/tools-list contract failed`);
  }
  assert(
    !existsSync(join(env.MITORI_HOME, "config.json")) && !existsSync(join(env.MITORI_HOME, "daemon.json")),
    "preview or MCP handshake unexpectedly started/configured a daemon",
  );

  // Directly invoke the same selected Bun/start script; no package-manager parent can outlive cleanup.
  const daemon = spawn(process.execPath, ["scripts/start.ts", "_serve", "--port", "0"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  daemon.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  daemon.stderr.on("data", () => {}); // Consume, never publish registry/auth/error content.
  const exited = new Promise<number | null>((resolve) => daemon.once("exit", resolve));
  try {
    const deadline = Date.now() + 30_000;
    let origin = "";
    while (!origin && Date.now() < deadline && daemon.exitCode === null) {
      origin = /^http:\/\/127\.0\.0\.1:\d+\//m.exec(stdout)?.[0] ?? "";
      if (!origin) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(origin, "internal daemon did not announce its loopback URL");
    const health = await fetch(`${origin}api/v1/health`, { signal: AbortSignal.timeout(5000) });
    report.http.health = health.ok && ((await health.json()) as { ok: boolean }).ok;
    assert(report.http.health, "internal health endpoint failed");
    const ui = await fetch(origin, { signal: AbortSignal.timeout(5000) });
    const html = await ui.text();
    report.http.ui = ui.ok && /<script\b/.test(html) && !html.includes("web shell is not built");
    assert(report.http.ui, "internal UI did not serve built assets");
  } finally {
    daemon.kill("SIGTERM");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const code = await Promise.race([
      exited,
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), 5000);
      }),
    ]);
    clearTimeout(timeout);
    if (code === "timeout") {
      daemon.kill("SIGKILL");
      await exited;
    }
    report.http.stopped = code === 0;
    assert(report.http.stopped, "internal daemon did not stop cleanly");
  }
  report.ok = true;
} catch (error) {
  report.error = error instanceof assert.AssertionError ? error.message : "onboarding verification failed";
} finally {
  rmSync(base, { recursive: true, force: true });
}
const text = JSON.stringify(report, null, 2);
if (values.out) writeFileSync(values.out, `${text}\n`, { mode: 0o600 });
console.log(text);
process.exitCode = report.ok ? 0 : 1;
