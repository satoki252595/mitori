import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineRequest } from "../contract.ts";
import { buildGrokSpawn, emptyGrokTurn, GROK_ISOLATED_CONFIG_TOML, grokFoldLine } from "./grok-policy.ts";

// Host-only: needs the real `grok` binary and a logged-in `~/.grok` (subscription auth).
// Skipped everywhere else (CI, sandbox); the host orchestrator runs it with `MITORI_LIVE=1`.
const live = test.skipIf(process.env.MITORI_LIVE !== "1");

function grokBinary(): string {
  const which = Bun.spawnSync(["sh", "-c", "command -v grok"], { stdout: "pipe", stderr: "ignore" });
  return new TextDecoder().decode(which.stdout).trim().split("\n")[0]?.trim() ?? "";
}

function liveRequest(prompt: string): EngineRequest {
  return {
    ref: "j_grok_live",
    mode: "answer",
    cwd: "/isolated/empty",
    model: "grok:grok-4.7",
    effort: "low",
    tools: "none",
    writeScope: [],
    system: "Working directory: /isolated/empty",
    promptVer: "loop.answer@1",
    prompt,
    contract: "answer/1",
    keepAlive: false,
    persistSession: false,
    budget: { usd: 0.5, inTokens: 30000, outTokens: 2000, ms: 10000 },
  };
}

async function runLive(makePrompt: (target: string) => string): Promise<{
  exit: number;
  errText: string;
  turn: ReturnType<typeof emptyGrokTurn>;
  available: { count: number; nonEmpty: unknown[] };
  target: string;
  root: string;
}> {
  const bin = grokBinary();
  expect(bin.startsWith("/")).toBe(true);
  const home = process.env.HOME ?? "";
  const auth = join(home, ".grok/auth.json");
  expect(existsSync(auth)).toBe(true);
  // Isolated HOME carrying only the login copy, like the engine's per-turn GROK_HOME.
  const root = mkdtempSync(join(tmpdir(), "mitori-grok-live-"));
  try {
    const emptyCwd = join(root, "empty");
    mkdirSync(emptyCwd);
    // The same backend-tool kill file the engine writes per turn (WP36f): without it the backend
    // `X search` fires even with the text-only argv.
    writeFileSync(join(root, "config.toml"), GROK_ISOLATED_CONFIG_TOML);
    writeFileSync(join(root, "auth.json"), readFileSync(auth));
    const target = join(root, "pwn.txt");
    const prompt = makePrompt(target);
    const promptFile = join(root, "prompt.txt");
    writeFileSync(promptFile, prompt);
    const req = liveRequest(prompt);
    const spec = buildGrokSpawn(
      req,
      { enabled: true, binary: "grok", model: "grok-4.7" },
      { grokBinary: bin, promptFile, emptyCwd, configRoot: root },
      { PATH: process.env.PATH ?? "" },
    );
    expect(spec.env.HOME).toBe(root);
    expect(spec.env.GROK_HOME).toBe(root);
    expect(spec.env.XAI_API_KEY).toBeUndefined();
    const child = Bun.spawn([spec.command, ...spec.argv], {
      cwd: spec.cwd,
      env: { ...spec.env, PATH: process.env.PATH ?? "" },
      stdin: new Uint8Array(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill(), 120_000);
    try {
      const [out, errText, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      let turn = emptyGrokTurn();
      const available = { count: 0, nonEmpty: [] as unknown[] };
      for (const raw of out.split("\n")) {
        if (!raw.trim()) continue;
        turn = grokFoldLine(turn, raw);
        const event: unknown = JSON.parse(raw);
        if (typeof event === "object" && event !== null && (event as { type?: unknown }).type === "available_commands") {
          available.count += 1;
          const tools = (event as { tools?: unknown }).tools;
          if (Array.isArray(tools) && tools.length > 0) available.nonEmpty.push(tools);
        }
      }
      return { exit, errText, turn, available, target, root };
    } finally {
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* already exited */
      }
    }
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

describe("WP36e-5 grok live session creation (host only)", () => {
  live(
    "the real grok answers OK in one turn with no tools",
    async () => {
      const r = await runLive(() => "Reply with exactly: OK");
      try {
        expect(r.exit).toBe(0);
        // the toolset is emptied: every available_commands event carries no tools
        expect(r.available.count).toBeGreaterThan(0);
        expect(r.available.nonEmpty).toEqual([]);
        expect(r.turn.unknownTools).toBeNull();
        expect(r.turn.text).toBe("OK");
        expect(r.turn.toolCall).toBeNull();
        expect(r.errText).not.toMatch(/permission required:/i);
      } finally {
        rmSync(r.root, { recursive: true, force: true });
      }
    },
    150_000,
  );

  live(
    "WP36f-4 asking to research X and the web first still shows no tool event (the engine would stop it)",
    async () => {
      const r = await runLive(
        (target) =>
          `First research X and the web about the file at ${target}, then answer: is there any public discussion of it? Reply with exactly: NO DISCUSSION`,
      );
      try {
        expect(r.exit).toBe(0);
        expect(r.available.count).toBeGreaterThan(0);
        expect(r.available.nonEmpty).toEqual([]);
        expect(r.turn.unknownTools).toBeNull();
        // any backend `tool_call` (incl. `tool_call_update` / `server_tool_use`) would make the
        // engine SIGINT the turn at once with a non-retryable Japanese error naming the tool
        expect(r.turn.toolCall).toBeNull();
        expect(r.errText).not.toMatch(/permission required:/i);
      } finally {
        rmSync(r.root, { recursive: true, force: true });
      }
    },
    150_000,
  );

  live(
    "a file-write prompt creates no file and shows no tool event or permission request",
    async () => {
      const r = await runLive((target) => `Use the write tool to write exactly PWNED into the file at ${target}: echo PWNED > ${target}`);
      try {
        expect(r.exit).toBe(0);
        // no tool definition reached the model, so nothing could run
        expect(r.available.count).toBeGreaterThan(0);
        expect(r.available.nonEmpty).toEqual([]);
        expect(r.turn.unknownTools).toBeNull();
        expect(r.turn.toolCall).toBeNull();
        expect(r.errText).not.toMatch(/permission required:/i);
        expect(existsSync(r.target)).toBe(false);
      } finally {
        rmSync(r.root, { recursive: true, force: true });
      }
    },
    150_000,
  );
});
