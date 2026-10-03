import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceKey } from "@mitori/core";
import { createAgentBridge } from "./bridge/index.ts";
import { buildClaudeSpawn } from "./claude/index.ts";
import type { EngineRequest, ScheduledRequest } from "./contract.ts";
import {
  CassetteMissError,
  cassetteKey,
  cassetteKeyFromSpawn,
  collectingSink,
  countingMetrics,
  createFakeClock,
  createFakeEngine,
  createImmediateScheduler,
  createReplaySpawner,
  createTestLogger,
  immediateWrite,
  memLedger,
  normalizeForKey,
  openCassettes,
  seededRandom,
  synth,
  testHasher,
  testSettings,
} from "./testing.ts";

const HOME = "/home/u/.mitori";
const EMPTY = `${HOME}/run/empty`;
const ctx = { cwd: EMPTY, home: HOME };

function req(o: Partial<EngineRequest> = {}): EngineRequest {
  return {
    ref: "j_1",
    mode: "patch",
    cwd: EMPTY,
    model: "claude-sonnet-5-5",
    effort: "low",
    tools: "none",
    writeScope: [],
    system: `Fixer.\nWorking directory: ${EMPTY}`,
    promptVer: "loop.patch@1",
    prompt: "MBF/1 mode=patch\n<<<DATA q8r2m4tz>>>\n1|x\n<<<END q8r2m4tz>>>\nASK\n> fix th_abcdefgh at 2026-10-03T01:02:03.456Z\nEND",
    contract: "patch/1",
    jsonSchema: { type: "object", properties: { b: { type: "number" }, a: { type: "string" } } },
    keepAlive: false,
    persistSession: false,
    budget: { usd: 0.1, inTokens: 0, outTokens: 0, ms: 0 },
    ...o,
  };
}

describe("@mitori/agent/testing — cassette layer (testing spec §3)", () => {
  test("normalizeForKey: CRLF, fence nonces, paths (longest first), timestamps, model-invisible ids only", () => {
    const s = normalizeForKey(
      `a\r\n<<<DATA q8r2m4tz x\n<<<END q8r2m4tz>>>\n${EMPTY}/f ${HOME}/x 2026-10-03T01:02:03Z th_abcdefgh b_abcdefgh j_0123456789`,
      ctx,
    );
    expect(s).toBe("a\n<<<DATA ######## x\n<<<END ########>>>\n$CWD/f $MITORI_HOME/x $TS $th_ID b_abcdefgh $j_ID");
  });

  test("cassetteKey(req) === cassetteKeyFromSpawn(buildClaudeSpawn(req)) (the golden equality of §3.3)", () => {
    for (const r of [req(), req({ mode: "answer", jsonSchema: undefined as never, contract: "answer/1" }), req({ effort: "medium" })]) {
      const spf = `${HOME}/run/sp/${testHasher.sha256(r.system).slice(0, 32)}.txt`;
      const spec = buildClaudeSpawn(r, testSettings().engines["claude-cli"], { claudeBinary: "/bin/claude", systemPromptFile: spf, emptyCwd: EMPTY }, {});
      const fromSpawn = cassetteKeyFromSpawn(spec, (p) => (p === spf ? r.system : ""), ctx);
      expect(fromSpawn).toBe(cassetteKey(r, "claude-cli", ctx));
    }
    // the nonce and timestamps do not change the key; the prompt text does
    expect(cassetteKey(req({ prompt: req().prompt.replaceAll("q8r2m4tz", "z9y8x7w6") }), "claude-cli", ctx)).toBe(cassetteKey(req(), "claude-cli", ctx));
    expect(cassetteKey(req({ prompt: "other" }), "claude-cli", ctx)).not.toBe(cassetteKey(req(), "claude-cli", ctx));
  });

  test("store + ReplaySpawner: exact key, scenario router, miss error, sanitize on save, unused report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mitori-cassettes-"));
    try {
      const store = openCassettes({ dirs: [dir], mode: "record" });
      const r = req();
      const key = cassetteKey(r, "claude-cli", ctx);
      const c = synth.text("{}", { structured: { a: "1" } });
      await store.save({ header: { ...c.header, key, match: "exact" }, lines: c.lines }, "=== prompt ===\n");
      expect(readFileSync(join(dir, `${key}.prompt.txt`), "utf8")).toContain("prompt");
      await expect(store.save({ header: c.header, lines: [{ dt: 0, line: '{"type":"x","k":"AKIAABCDEFGHIJKLMNOP"}' }] }, "")).rejects.toThrow(/secret/);
      await expect(store.save(synth.failure("auth_source_api_key"), "")).rejects.toThrow(/lean/);
      const replayStore = openCassettes({ dirs: [dir], mode: "replay" });
      const bridge = createAgentBridgeFor(createReplaySpawner(replayStore, { keyContext: ctx, readFile: () => r.system }));
      const res = await bridge.scheduler.submit(sched(r), new AbortController().signal).result;
      expect(res.structured).toEqual({ a: "1" });
      expect(replayStore.unused()).toEqual([]);
      const miss = createReplaySpawner(replayStore, { keyContext: ctx, readFile: () => "different system" });
      expect(() =>
        miss.spawn(
          buildClaudeSpawn(
            r,
            testSettings().engines["claude-cli"],
            { claudeBinary: "/bin/claude", systemPromptFile: `${HOME}/run/sp/${"0".repeat(32)}.txt`, emptyCwd: EMPTY },
            {},
          ),
        ),
      ).toThrow(CassetteMissError);
      const scen = createReplaySpawner(replayStore, { keyContext: ctx, readFile: () => "", scenario: () => "nope" });
      expect(() =>
        scen.spawn(
          buildClaudeSpawn(
            r,
            testSettings().engines["claude-cli"],
            { claudeBinary: "/bin/claude", systemPromptFile: `${HOME}/run/sp/${"0".repeat(32)}.txt`, emptyCwd: EMPTY },
            {},
          ),
        ),
      ).toThrow(/scenario:nope/);
      expect(() => openCassettes({ dirs: [dir], mode: "replay" }).save(c, "")).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("FakeEngine replays through the real normalizer; the immediate scheduler records submissions", async () => {
    const fe = createFakeEngine({}).on({ when: (r) => r.mode === "answer", reply: synth.text("fake answer") });
    const s = createImmediateScheduler({ "claude-cli": fe });
    const r = await s.submit(sched(req({ mode: "answer", jsonSchema: undefined as never })), new AbortController().signal).result;
    expect(r.text).toBe("fake answer");
    expect(s.submitted).toHaveLength(1);
    expect(fe.requests).toHaveLength(1);
    const none = await fe.run(req({ mode: "findings" }), new AbortController().signal).result;
    expect(none.stop).toBe("error");
  });
});

function sched(r: EngineRequest): ScheduledRequest {
  return {
    ...r,
    engine: "claude-cli",
    lane: "interactive",
    ws: "ws_aaaaaaaaaaaa" as WorkspaceKey,
    scope: { kind: "job", id: "j_1" },
    estimate: { in: 1, out: 1 },
  };
}

function createAgentBridgeFor(spawner: Parameters<typeof createAgentBridge>[0]["spawner"]) {
  const fs = (() => {
    const files = new Map<string, Uint8Array>();
    return {
      safeWrite: {
        write: async (root: string, rel: string, bytes: Uint8Array | string) => {
          files.set(`${root}/${rel}`, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
        },
        remove: async () => {},
      },
      fs: {
        stat: (p: string) => (files.has(p) ? { size: 0, mtimeNs: 0n, ino: 0n, isFile: true, isDir: false, isSymlink: false } : null),
        read: async (p: string) => files.get(p) ?? new Uint8Array(),
        readHead: async () => new Uint8Array(),
        realpath: (p: string) => p,
        readdir: () => [],
      },
    };
  })();
  const clock = createFakeClock();
  const deps = {
    stateWrite: immediateWrite,
    random: seededRandom(5),
    metrics: countingMetrics(),
    safePath: "/usr/bin",
    settings: () => testSettings(),
    spawner,
    ledger: memLedger(clock),
    log: createTestLogger(),
    clock,
    hasher: testHasher,
    events: collectingSink<import("@mitori/core").SseEventPayload>(),
    home: HOME,
    env: {},
    ...fs, // CR-PENDING(WP-05) cr-requests #2
  };
  return createAgentBridge(deps);
}

describe("createAgentBridge (B7)", () => {
  test("returns the scheduler and every engine id (session/codex-cli null until their WPs)", () => {
    const b = createAgentBridgeFor({ spawn: () => Promise.reject() as never });
    expect(Object.keys(b.engines).sort()).toEqual(["anthropic-api", "claude-cli", "codex-cli", "generic", "session"]);
    expect(b.engines.session).toBeNull();
    expect(b.engines["codex-cli"]).toBeNull();
    expect(b.scheduler.status().concurrency).toBe(3);
  });

  test("without the fs ports (CR-PENDING) a claude-cli run fails with E_PRECONDITION, not a crash", async () => {
    const clock = createFakeClock();
    const log = createTestLogger();
    const b = createAgentBridge({
      stateWrite: immediateWrite,
      random: seededRandom(5),
      metrics: countingMetrics(),
      safePath: "/usr/bin",
      settings: () => testSettings(),
      spawner: { spawn: () => Promise.reject() as never },
      ledger: memLedger(clock),
      log,
      clock,
      hasher: testHasher,
      events: collectingSink(),
      home: HOME,
      env: {},
    });
    const r = await b.scheduler.submit(sched(req({ mode: "answer", jsonSchema: undefined as never })), new AbortController().signal).result;
    expect(r.error?.code).toBe("E_PRECONDITION");
    expect(log.lines.some((l) => l.msg === "agent.bridge.no_fs_ports")).toBe(true);
  });
});
