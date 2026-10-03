import { describe, expect, test } from "bun:test";
import type { WorkspaceKey } from "@mitori/core";
import type { ScheduledRequest } from "../contract.ts";
import { cassetteScript } from "../fakes/cassette.ts";
import { createFakeSpawner, createTestBridge, synth, TEST_CLAUDE_PIN, testHasher } from "../testing.ts";
import { warmProfileKey, warmProfileOf } from "./profile.ts";

const EMPTY = "/home/u/.mitori/run/empty";
const BIN = { realpath: TEST_CLAUDE_PIN.realpath, version: TEST_CLAUDE_PIN.version };

function req(o: Partial<ScheduledRequest> = {}): ScheduledRequest {
  return {
    ref: "j_1",
    mode: "answer",
    cwd: EMPTY,
    model: "claude-sonnet-5-5",
    effort: "low",
    tools: "none",
    writeScope: [],
    system: `Explainer.\nWorking directory: ${EMPTY}`,
    promptVer: "loop.answer@1",
    prompt: "q",
    contract: "answer/1",
    keepAlive: false,
    persistSession: false,
    budget: { usd: 0.05, inTokens: 0, outTokens: 1500, ms: 0 },
    engine: "claude-cli",
    lane: "interactive",
    ws: "ws_aaaaaaaaaaaa" as WorkspaceKey,
    scope: { kind: "job", id: "j_1" },
    estimate: { in: 800, out: 200 },
    ...o,
  };
}

describe("warm profiles (spec §6.6.1, CONS-32, PT-02)", () => {
  test("AGT-U-031 ENV_INJECT values are part of the warm-profile key; the job budget is not", () => {
    const key = (r: ScheduledRequest, persist = false) => {
      const p = warmProfileOf(r, testHasher, persist);
      if (!p) throw new Error("no profile");
      return warmProfileKey(p, BIN, testHasher);
    };
    expect(key(req())).toBe(key(req({ budget: { usd: 0.4, inTokens: 0, outTokens: 1500, ms: 0 } })));
    expect(key(req())).not.toBe(key(req(), true)); // CLAUDE_CODE_PROMPT_CACHE_TTL 5m vs 1h
    expect(key(req())).not.toBe(key(req({ system: `Other.\nWorking directory: ${EMPTY}` })));
    expect(key(req())).not.toBe(key(req({ effort: "medium" })));
    expect(key(req())).not.toBe(warmProfileKey(warmProfileOf(req(), testHasher, false) as never, { ...BIN, version: "2.2.0" }, testHasher));
    const p = warmProfileOf(req(), testHasher, false);
    expect(p?.envHash).toBe(testHasher.xxh3('{\n  "CLAUDE_CODE_PROMPT_CACHE_TTL": "5m"\n}\n'));
    expect(warmProfileOf(req({ mode: "agent", tools: "read_edit" }), testHasher, false)).toBeNull();
    expect(warmProfileOf(req({ mode: "generate" }), testHasher, false)).toBeNull();
  });

  test("AGT-U-025 warm pool: only an identical profile reuses the warm process (one job per process), at most 2, never for tools", async () => {
    const sp = createFakeSpawner().script(
      (s) => s.argv.includes("-p"),
      () => cassetteScript(synth.text("warm answer")),
    );
    const b = createTestBridge({ spawner: sp, settings: { engines: { "claude-cli": { warmPool: 2 } } } });
    const engine = b.engines["claude-cli"];
    if (!engine?.warm) throw new Error("no warm()");
    const profile = warmProfileOf(req(), testHasher, false);
    if (!profile) throw new Error("no profile");
    // a profile is warmed only after it ran once (its bytes are known)
    await engine.warm(profile);
    expect(sp.calls).toHaveLength(0);
    await b.scheduler.submit(req(), new AbortController().signal).result;
    expect(sp.calls).toHaveLength(1);
    await engine.warm(profile);
    await engine.warm(profile);
    await engine.warm(profile); // capped at perProfile = 2 (and residentMax 2)
    expect(sp.calls).toHaveLength(3);
    const warmSpecs = sp.calls.slice(1);
    expect(warmSpecs.every((s) => s.keepStdinOpen)).toBe(true);
    // warm processes carry the mode-floor backstop, not a job budget [CONS-32]
    expect(warmSpecs.every((s) => s.argv[s.argv.indexOf("--max-budget-usd") + 1] === "0.0500")).toBe(true);
    expect(sp.children[1]?.stdinText()).toBe(""); // idle: no prompt, no API call
    const r = await b.scheduler.submit(req({ prompt: "second job" }), new AbortController().signal).result;
    expect(r.text).toBe("warm answer");
    expect(sp.children[1]?.stdinText()).toContain("second job"); // served by a warm process
    expect(sp.children[1]?.stdinClosed).toBe(true); // answer closes stdin after the prompt: one job only
    await Bun.sleep(1);
    expect(sp.calls).toHaveLength(4); // consuming a recently used profile refills one warm process
    expect(sp.calls[3]?.keepStdinOpen).toBe(true);
    // another profile (system prompt differs) spawns cold and does not refill
    await b.scheduler.submit(req({ system: `Other.\nWorking directory: ${EMPTY}` }), new AbortController().signal).result;
    expect(sp.calls).toHaveLength(5);
    // a job budget above the mode floor never uses a warm process (its backstop would cut the job short)
    await b.scheduler.submit(req({ budget: { usd: 0.2, inTokens: 0, outTokens: 1500, ms: 0 } }), new AbortController().signal).result;
    expect(sp.calls).toHaveLength(6);
    await engine.closeAll?.();
    expect(sp.children.every((c) => c.stdinClosed || c.signals.length > 0)).toBe(true);
  });

  test("AGT-U-025 billing switching to overage closes the warm pool (spec §6.8)", async () => {
    let overage = false;
    const sp = createFakeSpawner().script(
      (s) => s.argv.includes("-p"),
      () => cassetteScript(synth.text("x", { window: { fiveHour: 0.3, overage } })),
    );
    const b = createTestBridge({ spawner: sp, settings: { engines: { "claude-cli": { warmPool: 1 } } } });
    const profile = warmProfileOf(req(), testHasher, false);
    if (!profile) throw new Error("no profile");
    await b.scheduler.submit(req(), new AbortController().signal).result;
    await b.engines["claude-cli"]?.warm?.(profile);
    expect(sp.calls).toHaveLength(2);
    expect(sp.children[1]?.stdinClosed).toBe(false);
    overage = true;
    await b.scheduler.submit(req({ system: `Other.\nWorking directory: ${EMPTY}` }), new AbortController().signal).result;
    expect(b.scheduler.window()?.billing).toBe("overage");
    expect(sp.children[1]?.stdinClosed).toBe(true);
  });

  test("AGT-U-025 the resident cap (warm + parked ≤ 2) evicts a warm process before a parked job session", async () => {
    const sp = createFakeSpawner().script(
      (s) => s.argv.includes("-p"),
      (s) => cassetteScript(s.argv.includes("--json-schema") ? synth.text("{}", { structured: { summary: "s" } }) : synth.text("warm")),
    );
    const b = createTestBridge({ spawner: sp, settings: { engines: { "claude-cli": { warmPool: 1 } } } });
    const profile = warmProfileOf(req(), testHasher, false);
    if (!profile) throw new Error("no profile");
    await b.scheduler.submit(req(), new AbortController().signal).result;
    await b.engines["claude-cli"]?.warm?.(profile);
    expect(sp.calls).toHaveLength(2);
    const patch = (n: number) =>
      req({ ref: `j_${n}`, mode: "patch", promptVer: "loop.patch@1", contract: "patch/1", jsonSchema: { type: "object" }, keepAlive: true, prompt: `p${n}` });
    const p1 = b.scheduler.submit(patch(1), new AbortController().signal);
    await p1.result;
    const p2 = b.scheduler.submit(patch(2), new AbortController().signal);
    await p2.result;
    await Bun.sleep(1);
    // 1 warm + 2 parked > 2: the speculative warm process goes, both job conversations stay parked
    expect(sp.children[1]?.stdinClosed).toBe(true);
    expect([p1.session?.parked(), p2.session?.parked()]).toEqual([true, true]);
  });

  test("AGT-U-025 warmPool 0 (default) never pre-spawns", async () => {
    const sp = createFakeSpawner().script(
      () => true,
      () => cassetteScript(synth.text("x")),
    );
    const b = createTestBridge({ spawner: sp });
    await b.scheduler.submit(req(), new AbortController().signal).result;
    const profile = warmProfileOf(req(), testHasher, false);
    if (!profile) throw new Error("no profile");
    b.scheduler.prewarm(profile);
    await Bun.sleep(5);
    expect(sp.calls).toHaveLength(1);
  });
});
