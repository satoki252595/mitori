import { describe, expect, test } from "bun:test";
import type { JobEvent, WorkspaceKey } from "@mitori/core";
import { CLAUDE_MODE_DEFAULTS, type EngineRequest, type EngineRun, type ScheduledRequest, SIGINT_GRACE_MS, WARM_POOL } from "../contract.ts";
import { cassetteScript } from "../fakes/cassette.ts";
import { createFakeClock, createFakeSpawner, createTestBridge, type ScriptedChild, synth, testHasher } from "../testing.ts";

const HOME = "/home/u/.mitori";
const EMPTY = `${HOME}/run/empty`;
const SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };

function req(mode: EngineRequest["mode"], o: Partial<ScheduledRequest> = {}): ScheduledRequest {
  const cwd = mode === "agent" ? "/home/u/.mitori/wt/ws_x/j_1" : EMPTY;
  return {
    ref: "j_0000000001",
    mode,
    cwd,
    model: "claude-sonnet-5-5",
    effort: "low",
    tools: mode === "agent" ? "read_edit" : "none",
    writeScope: mode === "agent" ? ["src/a.ts"] : [],
    system: `You are a test.\nWorking directory: ${cwd}`,
    promptVer: `loop.${mode}@1`,
    prompt: "Explain the retry loop.",
    contract: "answer/1",
    ...(mode === "findings" || mode === "patch" || mode === "agent" ? { jsonSchema: SCHEMA } : {}),
    keepAlive: mode === "patch" || mode === "agent" || mode === "generate",
    persistSession: false,
    budget: { usd: 0.1, inTokens: 0, outTokens: 0, ms: 120_000 },
    engine: "claude-cli",
    lane: "interactive",
    ws: "ws_aaaaaaaaaaaa" as WorkspaceKey,
    scope: { kind: "job", id: "j_0000000001" },
    estimate: { in: 1000, out: 300 },
    ...o,
  };
}

const ctl = () => new AbortController().signal;
const drainEvents = async (run: EngineRun): Promise<JobEvent[]> => {
  const out: JobEvent[] = [];
  for await (const e of run.events) out.push(e);
  return out;
};
const isClaude = (s: { argv: readonly string[] }) => s.argv.includes("-p");

describe("claude-cli engine over a scripted CLI", () => {
  test("AGT-U-021 answer: text streams, usage only from result, one ledger row, system prompt file written 0600-kind home", async () => {
    const sp = createFakeSpawner().script(
      isClaude,
      cassetteScript(synth.text("The loop retries three times.", { usage: { input_tokens: 1200, output_tokens: 20 } })),
    );
    const b = createTestBridge({ spawner: sp });
    const run = b.scheduler.submit(req("answer"), ctl());
    const events = await drainEvents(run);
    const r = await run.result;
    expect(r.stop).toBe("end");
    expect(r.text).toBe("The loop retries three times.");
    expect(r.usageEstimated).toBe(false);
    expect(r.usage.in).toBe(1200);
    expect(r.auth).toBe("subscription");
    expect(
      events
        .filter((e) => e.t === "text")
        .map((e) => (e as { delta: string }).delta)
        .join(""),
    ).toBe("The loop retries three times.");
    expect(events.filter((e) => e.t === "usage" && e.final)).toHaveLength(1);
    expect(events[events.length - 1]?.t).toBe("result");
    expect(b.ledger.rows).toHaveLength(1);
    expect(b.ledger.rows[0]?.usage.in).toBe(1200);
    expect(b.ledger.rows[0]?.outcome).toBe("ok");
    expect(b.ledger.rows[0]?.promptId).toBe("loop.answer");
    const spec = sp.calls[0];
    expect(spec?.cwd).toBe(EMPTY);
    const spf = spec?.argv[spec.argv.indexOf("--system-prompt-file") + 1] as string;
    expect(spf).toMatch(/^\/home\/u\/\.mitori\/run\/sp\/[0-9a-f]{32}\.txt$/);
    expect(new TextDecoder().decode(b.fs.files.get(spf))).toBe(req("answer").system);
    expect(b.fs.writes.find((w) => w.path === spf)?.kind).toBe("home");
    expect(sp.children[0]?.stdinClosed).toBe(true);
    expect(sp.children[0]?.stdinText()).toBe(`${JSON.stringify({ type: "user", message: { role: "user", content: "Explain the retry loop." } })}\n`);
    expect(spec?.env.PATH).toBe("/usr/bin:/bin"); // SAFE_PATH, not the parent PATH
  });

  test("AGT-U-021 the system prompt file is byte-compared before reuse (SEC-20) and the sandbox is emptied (I9)", async () => {
    const sp = createFakeSpawner().script(isClaude, () => cassetteScript(synth.text("ok")));
    const b = createTestBridge({ spawner: sp });
    await b.scheduler.submit(req("answer"), ctl()).result;
    const spf = sp.calls[0]?.argv[sp.calls[0].argv.indexOf("--system-prompt-file") + 1] as string;
    b.fs.files.set(spf, new TextEncoder().encode("tampered"));
    b.fs.files.set(`${EMPTY}/CLAUDE.md`, new TextEncoder().encode("canary"));
    await b.scheduler.submit(req("answer"), ctl()).result;
    expect(new TextDecoder().decode(b.fs.files.get(spf))).toBe(req("answer").system);
    expect(b.fs.files.has(`${EMPTY}/CLAUDE.md`)).toBe(false);
  });

  test("AC-L31 AC-L36 patch parks: continuation reuses the process (no new spawn), reportedUsd is the cumulative delta, 1 row per turn", async () => {
    const c = synth.turns(["{}", "{}"], { structured: { summary: "fixed" }, usage: { input_tokens: 1000, output_tokens: 50 } });
    const sp = createFakeSpawner().script(isClaude, cassetteScript(c));
    const b = createTestBridge({ spawner: sp });
    const run = b.scheduler.submit(req("patch"), ctl());
    const r1 = await run.result;
    expect(r1.structured).toEqual({ summary: "fixed" });
    const session = run.session;
    expect(session?.parked()).toBe(true);
    const run2 = b.scheduler.continueSession(
      session as NonNullable<typeof session>,
      "Fix the failing GATE above.",
      {
        lane: "interactive",
        ws: "ws_aaaaaaaaaaaa",
        scope: { kind: "job", id: "j_1" },
        estimate: { in: 500, out: 100 },
        budget: { usd: 0.05, inTokens: 0, outTokens: 0, ms: 0 },
        ref: "j_1",
      },
      ctl(),
    );
    const r2 = await run2.result;
    expect(r2.stop).toBe("end");
    expect(sp.calls).toHaveLength(1);
    expect(sp.children[0]?.stdinText().split("\n").filter(Boolean)).toHaveLength(2);
    expect(r1.usage.reportedUsd).toBeCloseTo(r2.usage.reportedUsd ?? -1, 6);
    expect(b.ledger.rows).toHaveLength(2);
    expect(b.ledger.rows[1]?.model).toBe("claude-sonnet-5-5");
    expect(b.metrics.counts["agent.continuations"]).toBe(1);
    await session?.close();
    expect(sp.children[0]?.stdinClosed).toBe(true);
    expect(session?.parked()).toBe(false);
    expect(() => session?.continue("again", { usd: 0.1, inTokens: 0, outTokens: 0, ms: 0 }, ctl())).toThrow(/gone/);
  });

  test("AGT-U-021 parked processes close after the park TTL; resident cap closes the oldest", async () => {
    const clock = createFakeClock();
    const sp = createFakeSpawner().script(isClaude, () => cassetteScript(synth.text("{}", { structured: { summary: "s" } })));
    const b = createTestBridge({ spawner: sp, clock });
    const runs = [b.scheduler.submit(req("patch"), ctl()), b.scheduler.submit(req("patch"), ctl()), b.scheduler.submit(req("patch"), ctl())];
    for (const r of runs) await r.result;
    await Bun.sleep(5);
    // residentMax 2: the first parked process was closed when the third parked
    expect(runs.map((r) => r.session?.parked())).toEqual([false, true, true]);
    expect(sp.children[0]?.stdinClosed).toBe(true);
    clock.advance(WARM_POOL.parkTtlMs + 1);
    await Bun.sleep(5);
    expect(runs.map((r) => r.session?.parked())).toEqual([false, false, false]);
  });

  test("AC-L32 init violation (apiKeySource ≠ none) ⇒ SIGINT and E_AGENT_AUTH_SOURCE; ledger outcome error", async () => {
    // paced lines: the SIGINT lands before the CLI would print anything past init (as with the real CLI, CC-09)
    const sp = createFakeSpawner({ speed: 1 }).script(isClaude, cassetteScript(synth.failure("auth_source_api_key")));
    const b = createTestBridge({ spawner: sp });
    const run = b.scheduler.submit(req("answer"), ctl());
    const r = await run.result;
    expect(r.stop).toBe("error");
    expect(r.error?.code).toBe("E_AGENT_AUTH_SOURCE");
    expect(r.auth).toBe("api-key");
    expect(sp.children[0]?.signals[0]).toBe("SIGINT");
    expect(b.ledger.rows).toHaveLength(1);
    expect(b.ledger.rows[0]?.outcome).toBe("error");
    // SIGINT at the init check precedes the API request (CC-09): the meter's input estimate is not ledgered as spend
    expect(b.ledger.rows[0]?.usage.apiUsd).toBe(0);
    expect(b.ledger.rows[0]?.usage.in).toBe(0);
  });

  test("AC-L36 a continuation whose process dies before its first line ledgers zero, not the previous turn again", async () => {
    // one scripted turn: the parked child prints nothing for the continuation
    const c = synth.text("{}", { structured: { summary: "fixed" }, usage: { input_tokens: 4000, output_tokens: 80 } });
    const sp = createFakeSpawner().script(isClaude, cassetteScript(c));
    const b = createTestBridge({ spawner: sp });
    const run = b.scheduler.submit(req("patch"), ctl());
    const r1 = await run.result;
    expect(r1.usage.apiUsd).toBeGreaterThan(0);
    const session = run.session as NonNullable<typeof run.session>;
    const run2 = b.scheduler.continueSession(
      session,
      "Fix the failing GATE above.",
      {
        lane: "interactive",
        ws: "ws_aaaaaaaaaaaa",
        scope: { kind: "job", id: "j_1" },
        estimate: { in: 500, out: 100 },
        budget: { usd: 0.05, inTokens: 0, outTokens: 0, ms: 0 },
        ref: "j_1",
      },
      ctl(),
    );
    await Bun.sleep(1);
    sp.children[0]?.kill("SIGKILL"); // killed from outside (OOM) before the CLI printed anything for turn 2
    const r2 = await run2.result;
    expect(r2.stop).toBe("error");
    expect(r2.error?.code).toBe("E_AGENT_EXIT");
    expect(r2.usage.apiUsd).toBe(0);
    expect(r2.ttftMs === undefined || r2.ttftMs >= 0).toBe(true);
    expect(b.ledger.rows.map((x) => x.usage.apiUsd)).toEqual([r1.usage.apiUsd, 0]);
  });

  test("AGT-U-027 stream-json shape drift at runtime ⇒ E_AGENT_CAPABILITY (re-detect), the turn ends instead of hanging", async () => {
    const base = synth.text("{}", { structured: { summary: "s" } });
    const dropUsage = (l: string) => {
      const o = JSON.parse(l) as Record<string, unknown>;
      if (o.type === "result") delete o.usage;
      return JSON.stringify(o);
    };
    for (const [what, mutate] of [
      ["result without usage", dropUsage],
      ["assistant without message", (l: string) => (l.includes('"type":"assistant"') ? '{"type":"assistant"}' : l)],
      ["init without apiKeySource", (l: string) => l.replace('"apiKeySource":"none",', "")],
    ] as const) {
      const lines = base.lines.map((l) => (l.line ? { ...l, line: mutate(l.line) } : l));
      const sp = createFakeSpawner().script(isClaude, cassetteScript({ ...base, lines }));
      const b = createTestBridge({ spawner: sp });
      const r = await b.scheduler.submit(req("patch"), ctl()).result;
      expect({ what, stop: r.stop, code: r.error?.code }).toEqual({ what, stop: "error", code: "E_AGENT_CAPABILITY" });
      expect(sp.children[0]?.signals).toContain("SIGINT");
      expect(b.ledger.rows).toHaveLength(1);
    }
  });

  test("AC-L32 tools/skills/mcp/model drift ⇒ E_AGENT_CAPABILITY", async () => {
    for (const mutate of [
      (l: string) => l.replace('"tools":[]', '"tools":["Bash"]'),
      (l: string) => l.replace('"mcp_servers":[]', '"mcp_servers":[{"name":"x","status":"connected"}]'),
      (l: string) => l.replace('"skills":[]', '"skills":["x"]'),
      (l: string) => l.replace('"model":"claude-sonnet-5-5"', '"model":"claude-opus-5-5"'),
    ]) {
      const c = synth.text("hi");
      const lines = c.lines.map((l, i) => (i === 0 && l.line ? { ...l, line: mutate(l.line) } : l));
      const sp = createFakeSpawner().script(isClaude, cassetteScript({ ...c, lines }));
      const b = createTestBridge({ spawner: sp });
      const r = await b.scheduler.submit(req("answer"), ctl()).result;
      expect(r.error?.code).toBe("E_AGENT_CAPABILITY");
      expect(sp.children[0]?.signals).toContain("SIGINT");
    }
    // a dated model id is the same model
    const c = synth.text("hi");
    const lines = c.lines.map((l, i) =>
      i === 0 && l.line ? { ...l, line: l.line.replace('"model":"claude-sonnet-5-5"', '"model":"claude-sonnet-5-5-20260901"') } : l,
    );
    const b = createTestBridge({ spawner: createFakeSpawner().script(isClaude, cassetteScript({ ...c, lines })) });
    expect((await b.scheduler.submit(req("answer"), ctl()).result).stop).toBe("end");
  });

  test("AC-L38 the meter SIGINTs at 80% of the job budget ⇒ budget / E_BUDGET_EXCEEDED, usage from the meter", async () => {
    const big = synth.text("x".repeat(4000), { usage: { input_tokens: 40_000, output_tokens: 2000 } });
    // drop the result: the CLI is interrupted before it would have finished
    const lines = big.lines.filter((l) => !l.line?.includes('"type":"result"'));
    const sp = createFakeSpawner().script(isClaude, {
      ...cassetteScript({ ...big, lines }),
      hang: true,
      lines: [
        ...(cassetteScript({ ...big, lines }).lines ?? []),
        {
          phase: "after_sigint",
          line: JSON.stringify({
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            session_id: "s",
            total_cost_usd: 0.09,
            usage: { input_tokens: 40_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 300 },
            permission_denials: [],
            duration_ms: 1,
            num_turns: 1,
          }),
        },
      ],
    });
    const b = createTestBridge({ spawner: sp });
    const r = await b.scheduler.submit(req("answer", { budget: { usd: 0.1, inTokens: 0, outTokens: 0, ms: 0 } }), ctl()).result;
    expect(r.stop).toBe("budget");
    expect(r.error?.code).toBe("E_BUDGET_EXCEEDED");
    expect(sp.children[0]?.signals[0]).toBe("SIGINT");
    expect(r.usageEstimated).toBe(false); // the SIGINT result carried usage
    expect(b.ledger.rows[0]?.outcome).toBe("budget");
  });

  test("AGT-U-026 hang: SIGINT on timeout, SIGKILL after SIGINT_GRACE_MS, never SIGTERM", async () => {
    const clock = createFakeClock();
    const sp = createFakeSpawner().script(isClaude, cassetteScript(synth.failure("hang")));
    const b = createTestBridge({ spawner: sp, clock });
    const run = b.scheduler.submit(req("answer"), ctl());
    await Bun.sleep(5);
    clock.advance(CLAUDE_MODE_DEFAULTS.answer.idleMs + 1);
    await Bun.sleep(1);
    expect(sp.children[0]?.signals).toEqual(["SIGINT"]);
    clock.advance(SIGINT_GRACE_MS - 10);
    expect(sp.children[0]?.signals).toEqual(["SIGINT"]);
    clock.advance(20);
    const r = await run.result;
    expect(sp.children[0]?.signals).toEqual(["SIGINT", "SIGKILL"]);
    expect(r.stop).toBe("error");
    expect(r.error?.code).toBe("E_AGENT_TIMEOUT");
    expect(r.usageEstimated).toBe(true);
    expect(b.ledger.rows).toHaveLength(1);
  });

  test("AGT-U-021 cancel: SIGINT, the recorded tail result is kept, outcome cancelled", async () => {
    const tail = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: "s",
      total_cost_usd: 0.004,
      usage: { input_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 12 },
      permission_denials: [],
      duration_ms: 900,
      num_turns: 1,
    };
    const script: ScriptedChild = {
      ...cassetteScript(synth.failure("hang")),
      lines: [...(cassetteScript(synth.failure("hang")).lines ?? []), { phase: "after_sigint", line: JSON.stringify(tail) }],
    };
    const sp = createFakeSpawner().script(isClaude, script);
    const b = createTestBridge({ spawner: sp });
    const ac = new AbortController();
    const run = b.scheduler.submit(req("answer"), ac.signal);
    await Bun.sleep(5);
    ac.abort();
    const r = await run.result;
    expect(r.stop).toBe("cancelled");
    expect(r.usage.in).toBe(900);
    expect(r.error).toBeUndefined();
    expect(b.ledger.rows[0]?.outcome).toBe("cancelled");
  });

  test("AGT-U-021 exit without result: E_AGENT_EXIT (+3 stderr lines) or E_AGENT_PROTOCOL; garbage stdout is tolerated", async () => {
    const b1 = createTestBridge({ spawner: createFakeSpawner().script(isClaude, cassetteScript(synth.failure("exit_nonzero"))) });
    const r1 = await b1.scheduler.submit(req("answer"), ctl()).result;
    expect(r1.error?.code).toBe("E_AGENT_EXIT");
    expect(r1.error?.stderrTail).toEqual(["error line 48", "error line 49", "error line 50"]);
    const b2 = createTestBridge({ spawner: createFakeSpawner().script(isClaude, cassetteScript(synth.failure("truncated_no_result"))) });
    expect((await b2.scheduler.submit(req("answer"), ctl()).result).error?.code).toBe("E_AGENT_PROTOCOL");
    const b3 = createTestBridge({ spawner: createFakeSpawner().script(isClaude, cassetteScript(synth.failure("garbage_stdout"))) });
    const r3 = await b3.scheduler.submit(req("answer"), ctl()).result;
    expect(r3.stop).toBe("end");
    expect(r3.text).toBe("hello world, this answer survives garbage");
  });

  test("AGT-U-021 refusal and max budget map to stop reasons", async () => {
    const b1 = createTestBridge({ spawner: createFakeSpawner().script(isClaude, cassetteScript(synth.failure("refusal"))) });
    const r1 = await b1.scheduler.submit(req("answer"), ctl()).result;
    expect(r1.stop).toBe("refusal");
    expect(r1.error?.code).toBe("E_AGENT_REFUSAL");
    const b2 = createTestBridge({ spawner: createFakeSpawner().script(isClaude, cassetteScript(synth.failure("budget_exceeded"))) });
    const r2 = await b2.scheduler.submit(req("answer"), ctl()).result;
    expect(r2.stop).toBe("budget");
    expect(b2.ledger.rows[0]?.outcome).toBe("budget");
  });

  test("AGT-U-021 permission denials are reported worktree-relative", async () => {
    const wt = "/home/u/.mitori/wt/ws_x/j_1";
    const c = synth.failure("permission_denied", {
      structured: { summary: "s" },
      tools: ["Read", "Edit", "Glob", "Grep", "StructuredOutput"],
      denials: [{ tool: "Edit", target: `${wt}/README.md` }],
    });
    const b = createTestBridge({ spawner: createFakeSpawner().script(isClaude, cassetteScript(c)) });
    const r = await b.scheduler.submit(req("agent", { keepAlive: false }), ctl()).result;
    expect(r.stop).toBe("end");
    expect(r.denials).toEqual([{ tool: "Edit", target: "README.md", reason: "permission denied" }]);
  });

  test("fixed overhead samples use the first API call of a turn (an agent turn's result sums every tool round-trip)", async () => {
    const tools = ["Read", "Edit", "Glob", "Grep", "StructuredOutput"];
    const c = synth.text("{}", { structured: { summary: "s" }, tools, usage: { input_tokens: 3000, output_tokens: 40 } });
    const second = JSON.stringify({
      type: "stream_event",
      event: { type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 3500, output_tokens: 1 } } },
    });
    const lines = c.lines.flatMap((l) => {
      if (!l.line?.includes('"type":"result"')) return [l];
      const r = JSON.parse(l.line) as { usage: { input_tokens: number } };
      r.usage.input_tokens = 6500; // the CLI's per-turn sum of both calls
      return [
        { ...l, line: second },
        { ...l, line: JSON.stringify(r) },
      ];
    });
    const b = createTestBridge({ spawner: createFakeSpawner().script(isClaude, cassetteScript({ ...c, lines })) });
    const r = await b.scheduler.submit(req("agent", { keepAlive: false, promptVer: "loop.agent@1" }), ctl()).result;
    expect(r.stop).toBe("end");
    expect(r.usage.in).toBe(6500);
    const o = b.ledger.fixedOverhead(testHasher.xxh3("claude-cli\nagent\nclaude-sonnet-5-5\nloop.agent@1"));
    expect(o?.n).toBe(1);
    expect(o?.tokens).toBeGreaterThan(2950);
    expect(o?.tokens).toBeLessThanOrEqual(3000);
  });

  test("AGT-U-027 detect: version/auth/help probes; missing binary pin, API-key auth and --bare default are problems", async () => {
    const help =
      "Usage: claude\n  -p, --print  x\n  --bare  Minimal mode\n  --output-format --input-format --verbose --include-partial-messages --model --effort --tools --allowedTools --permission-mode --setting-sources --strict-mcp-config --disable-slash-commands --restricted --no-session-persistence --resume --json-schema --max-budget-usd --system-prompt[-file] --permission-prompts --session-id\n";
    const mk = (auth: string, h = help) =>
      createFakeSpawner()
        .script((s) => s.argv[0] === "--version", { stdout: ["2.1.288 (Claude Code)"] })
        .script((s) => s.argv[0] === "auth", { stdout: [auth] })
        .script((s) => s.argv[0] === "--help", { stdout: h.split("\n") });
    const ok = createTestBridge({ spawner: mk(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max", email: "x@y" })) });
    const s = await ok.engines["claude-cli"]?.detect();
    expect(s?.installed).toBe(true);
    expect(s?.auth).toBe("subscription");
    expect(s?.plan).toBe("max");
    expect(s?.problems).toEqual([]);
    expect(s?.capabilities).toContain("system-prompt-file");
    expect(JSON.stringify(s)).not.toContain("x@y");
    expect(ok.events.events.some((e) => e.type === "engines.updated")).toBe(true);
    const key = createTestBridge({ spawner: mk(JSON.stringify({ loggedIn: true, authMethod: "api_key" })) });
    expect((await key.engines["claude-cli"]?.detect())?.problems.map((p) => p.code)).toEqual(["E_AGENT_AUTH_SOURCE"]);
    const bare = createTestBridge({
      spawner: mk(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), help.replace("Minimal mode", "Minimal mode (the default with -p)")),
    });
    const bs = await bare.engines["claude-cli"]?.detect();
    expect(bs?.problems.map((p) => p.code)).toEqual(["E_AGENT_CAPABILITY"]);
    expect(bs?.problems[0]?.message).toMatch(/Pull .*Copy as prompt/);
    const lack = createTestBridge({ spawner: mk(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), help.replace("--restricted", "")) });
    expect((await lack.engines["claude-cli"]?.detect())?.problems[0]?.message).toMatch(/--restricted/);
    const nopin = createTestBridge({ spawner: mk("{}"), settings: (x) => delete x.pins.claude });
    expect((await nopin.engines["claude-cli"]?.detect())?.problems[0]?.code).toBe("E_AGENT_NOT_INSTALLED");
    const proxied = createTestBridge({
      spawner: mk(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })),
      settings: { engines: { "claude-cli": { envPassthrough: ["ANTHROPIC_BASE_URL"] } } },
      env: { HOME: "/home/u", ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" },
    });
    expect((await proxied.engines["claude-cli"]?.detect())?.capabilities).toContain("via-proxy");
    const failing = createTestBridge({ spawner: createFakeSpawner().script(() => true, { exitCode: 1 }) });
    expect((await failing.engines["claude-cli"]?.detect())?.installed).toBe(false);
  });

  test("AGT-U-027 run without a pinned binary or fs ports fails fast without a ledger row", async () => {
    const b = createTestBridge({ spawner: createFakeSpawner(), settings: (x) => delete x.pins.claude });
    const r = await b.scheduler.submit(req("answer"), ctl()).result;
    expect(r.error?.code).toBe("E_AGENT_NOT_INSTALLED");
    expect(b.ledger.rows).toHaveLength(0);
  });
});
