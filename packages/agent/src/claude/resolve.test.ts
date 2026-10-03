import { describe, expect, test } from "bun:test";
import type { BinaryPin, FsReader, FsStat, WorkspaceKey } from "@mitori/core";
import type { ScheduledRequest } from "../contract.ts";
import { cassetteScript } from "../fakes/cassette.ts";
import { createFakeSpawner, createTestBridge, synth, testHasher } from "../testing.ts";
import { isBareName, resolveOnSafePath, untrustedOnFirstUse } from "./resolve.ts";

const HELP =
  "Usage: claude\n  -p, --print  x\n  --output-format --input-format --verbose --include-partial-messages --model --effort --tools --allowedTools --permission-mode --setting-sources --strict-mcp-config --disable-slash-commands --restricted --no-session-persistence --resume --json-schema --max-budget-usd --system-prompt[-file] --permission-prompts --session-id\n";
const AUTH = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" });
const isClaude = (s: { argv: readonly string[] }) => s.argv.includes("-p");

const probes = (version: () => string = () => "2.1.288 (Claude Code)") =>
  createFakeSpawner()
    .script(
      (s) => s.argv[0] === "--version",
      () => ({ stdout: [version()] }),
    )
    .script((s) => s.argv[0] === "auth", { stdout: [AUTH] })
    .script((s) => s.argv[0] === "--help", { stdout: HELP.split("\n") });

const unpinned = (x: { pins: { claude?: BinaryPin } }) => {
  delete x.pins.claude;
};

function answerReq(): ScheduledRequest {
  const cwd = "/home/u/.mitori/run/empty";
  return {
    ref: "j_0000000001",
    mode: "answer",
    cwd,
    model: "claude-sonnet-5-5",
    effort: "low",
    tools: "none",
    writeScope: [],
    system: `You are a test.\nWorking directory: ${cwd}`,
    promptVer: "loop.answer@1",
    prompt: "Explain the retry loop.",
    contract: "answer/1",
    keepAlive: false,
    persistSession: false,
    budget: { usd: 0.1, inTokens: 0, outTokens: 0, ms: 120_000 },
    engine: "claude-cli",
    lane: "interactive",
    ws: "ws_aaaaaaaaaaaa" as WorkspaceKey,
    scope: { kind: "job", id: "j_0000000001" },
    estimate: { in: 1000, out: 300 },
  };
}

/** A tiny FsReader with symlinks (memFs has none). */
function linkFs(entries: Record<string, { file: true } | { dir: true } | { link: string }>): FsReader {
  const st = (e: (typeof entries)[string]): FsStat => ({
    size: 1,
    mtimeNs: 0n,
    ino: 0n,
    isFile: "file" in e,
    isDir: "dir" in e,
    isSymlink: "link" in e,
  });
  const real = (p: string): string | null => {
    const e = entries[p];
    if (!e) return null;
    return "link" in e ? real(e.link) : p;
  };
  return {
    stat: (p) => (entries[p] ? st(entries[p]) : null),
    read: async () => new Uint8Array([1]),
    readHead: async () => new Uint8Array(),
    realpath: real,
    readdir: () => null,
  };
}

describe("AGT-U-032 resolveOnSafePath (SEC-10)", () => {
  test("first regular file wins; relative/empty entries, directories and dangling links are skipped; symlinks are followed", () => {
    const fs = linkFs({
      "/a/claude": { dir: true },
      "/b/claude": { link: "/nowhere" },
      "/c/claude": { link: "/opt/claude/versions/2.1.288" },
      "/opt/claude/versions/2.1.288": { file: true },
      "/d/claude": { file: true },
      "rel/claude": { file: true },
    });
    expect(resolveOnSafePath(fs, ":rel:/a:/b:/c/:/d", "claude")).toEqual({ path: "/c/claude", realpath: "/opt/claude/versions/2.1.288" });
    expect(resolveOnSafePath(fs, "/a:/b", "claude")).toBeNull();
    expect(resolveOnSafePath(fs, "/d", "../d/claude")).toBeNull();
  });

  test("only bare command names are looked up", () => {
    expect(isBareName("claude")).toBe(true);
    expect(isBareName("claude-2.1")).toBe(true);
    for (const bad of ["", "/usr/bin/claude", "./claude", "../claude", "-claude", ".claude", "a/b"]) expect(isBareName(bad)).toBe(false);
  });
});

describe("AGT-U-032 first-run pinning on the engine (TOFU, CR m1-65)", () => {
  test("no pin: `claude` on SAFE_PATH is resolved, probed, pinned by first-run and persisted once; the card is ready", async () => {
    const persisted: { engine: string; pin: BinaryPin }[] = [];
    const sp = probes();
    const b = createTestBridge({
      spawner: sp,
      settings: unpinned,
      pin: async (engine, pin) => {
        persisted.push({ engine, pin });
      },
    });
    const bytes = new TextEncoder().encode("#!claude-binary");
    b.fs.files.set("/bin/claude", bytes);
    const s = await b.engines["claude-cli"]?.detect();
    expect(s?.installed).toBe(true);
    expect(s?.problems).toEqual([]);
    expect(s?.path).toBe("/bin/claude");
    expect(s?.pin).toMatchObject({ path: "/bin/claude", realpath: "/bin/claude", version: "2.1.288 (Claude Code)", by: "first-run" });
    expect(s?.pin?.sha256).toBe(testHasher.sha256(bytes));
    expect(sp.calls.every((c) => c.command === "/bin/claude")).toBe(true);
    expect(persisted).toEqual([{ engine: "claude-cli", pin: s?.pin as BinaryPin }]);
    (b.engines["claude-cli"] as unknown as { invalidate(): void }).invalidate();
    await b.engines["claude-cli"]?.detect();
    expect(persisted).toHaveLength(1);
  });

  test("a later version change of a first-run pin ⇒ E_ENGINE_BINARY_CHANGED; nothing on SAFE_PATH ⇒ not installed", async () => {
    let version = "2.1.288 (Claude Code)";
    const b = createTestBridge({ spawner: probes(() => version), settings: unpinned });
    b.fs.files.set("/usr/bin/claude", new Uint8Array([1, 2, 3]));
    expect((await b.engines["claude-cli"]?.detect())?.problems).toEqual([]);
    version = "2.1.290 (Claude Code)";
    (b.engines["claude-cli"] as unknown as { invalidate(): void }).invalidate();
    expect((await b.engines["claude-cli"]?.detect())?.problems.map((p) => p.code)).toEqual(["E_ENGINE_BINARY_CHANGED"]);
    const none = createTestBridge({ spawner: probes(), settings: unpinned });
    const ns = await none.engines["claude-cli"]?.detect();
    expect(ns?.installed).toBe(false);
    expect(ns?.problems[0]?.code).toBe("E_AGENT_NOT_INSTALLED");
  });

  test("a run before any detect() pins first and spawns the resolved path; an absolute settings binary is not re-resolved", async () => {
    const sp = probes().script(isClaude, cassetteScript(synth.text("ok", { usage: { input_tokens: 100, output_tokens: 2 } })));
    const b = createTestBridge({ spawner: sp, settings: unpinned });
    b.fs.files.set("/usr/bin/claude", new Uint8Array([7]));
    const r = await b.scheduler.submit(answerReq(), new AbortController().signal).result;
    expect(r.stop).toBe("end");
    expect(sp.calls.filter(isClaude).map((c) => c.command)).toEqual(["/usr/bin/claude"]);
    const abs = createTestBridge({
      spawner: probes(),
      settings: (x) => {
        unpinned(x);
        x.engines["claude-cli"].binary = "/opt/claude/bin/claude";
      },
    });
    abs.fs.files.set("/usr/bin/claude", new Uint8Array([7]));
    const s = await abs.engines["claude-cli"]?.detect();
    expect(s?.path).toBe("/opt/claude/bin/claude");
    expect(s?.pin).toBeUndefined();
  });

  test("a first claude in a temporary directory is neither probed nor pinned, and later PATH entries are not tried", async () => {
    // SAFE_PATH of the test bridge is /usr/bin:/bin; TMPDIR=/usr/bin makes the first entry a temporary directory
    const sp = probes();
    const b = createTestBridge({ spawner: sp, settings: unpinned, env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u", TMPDIR: "/usr/bin/" } });
    b.fs.files.set("/usr/bin/claude", new Uint8Array([1]));
    b.fs.files.set("/bin/claude", new Uint8Array([7]));
    const s = await b.engines["claude-cli"]?.detect();
    expect(s?.installed).toBe(false);
    expect(s?.problems.map((p) => p.code)).toEqual(["E_AGENT_NOT_INSTALLED"]);
    expect(s?.problems[0]?.message).toMatch(/temporary directory/);
    expect(s?.pin).toBeUndefined();
    expect(sp.calls).toHaveLength(0);
  });

  test("untrustedOnFirstUse: temp prefixes (path or target) and TMPDIR; a native install is trusted", () => {
    const guard = "/private/var/folders/ab/xyz/T/mitori-spawn-guard-1/claude";
    expect(untrustedOnFirstUse({ path: guard, realpath: guard }, undefined)).toBe(true);
    expect(untrustedOnFirstUse({ path: "/home/u/.local/bin/claude", realpath: "/tmp/x/claude" }, undefined)).toBe(true);
    expect(untrustedOnFirstUse({ path: "/scratch/t/claude", realpath: "/scratch/t/claude" }, "/scratch/t/")).toBe(true);
    expect(untrustedOnFirstUse({ path: "/home/u/.local/bin/claude", realpath: "/home/u/.local/share/claude/versions/2.1.288" }, "/scratch/t")).toBe(false);
    expect(untrustedOnFirstUse({ path: "/opt/homebrew/bin/claude", realpath: "/opt/homebrew/lib/claude/cli.js" }, "relative")).toBe(false);
  });
});
