import { describe, expect, test } from "bun:test";
import type { GenCall } from "../contract.ts";
import { type ScriptReply, type Turn, validRouter } from "../test/fake-engine.ts";
import { makeHarness } from "../test/harness.ts";
import { M_CLI, M_SESSION } from "../test/repo.ts";
import { testSettings } from "../test/settings.ts";

/** Router whose matching calls wait until `open()`. */
function gated(match: (call: GenCall) => boolean) {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const router = (call: GenCall, t: Turn): ScriptReply => (match(call) && !t.continuation ? { ...validRouter(call, t), gate } : validRouter(call, t));
  return { router, open: () => open() };
}

const isEarly = (c: GenCall) => c.spec.id === "gen.overview" && c.mode === "early";
const tick = () => new Promise((r) => setTimeout(r, 5));
const serial = () => {
  const s = testSettings();
  s.global.scheduler.concurrency = 2; // C_bg = 2 − reserveInteractive = 1
  return s;
};
const target = ({ call: c }: { call: GenCall }) => /module (md_\w{8})/.exec(c.layout.unit)?.[1] ?? c.spec.id + (c.mode ? `:${c.mode}` : "");

describe("GEN-U-040 / AC-03 prioritize(section)", () => {
  test("the next dispatched task writes the boosted section; it moves to the doc lane; running tasks are not stopped", async () => {
    const g = gated(isEarly);
    const h = makeHarness({ router: g.router, settings: serial() });
    const est = await h.gen.estimate({ effort: "standard" });
    const run = await h.gen.start(est.id);
    h.gen.prioritize("s6/cli");
    g.open();
    await h.gen.idle();
    expect(h.engine.calls.map(target).slice(0, 3)).toEqual(["gen.overview:early", M_CLI, M_SESSION]);
    expect(h.engine.calls[1]?.call.lane).toBe("doc");
    expect(h.engine.calls[0]?.stopped).toEqual([]);
    expect(h.gen.run(run.id)?.run.state).toBe("done");
    const cli = h.gen.run(run.id)?.tasks.find((t) => t.target.id === M_CLI);
    expect(cli?.priority).toBeGreaterThan(1_000_000);
  });
});

describe("GEN-U-041 pause / resume / cancel", () => {
  test("pause stops dispatch after the running call; resume continues to done", async () => {
    const g = gated(isEarly);
    const h = makeHarness({ router: g.router, settings: serial() });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    const paused = await h.gen.control(run.id, "pause");
    expect(paused.state).toBe("paused");
    expect(paused.paused).toEqual({ reason: "user" });
    g.open();
    await h.gen.idle();
    expect(h.engine.calls.length).toBe(1);
    expect(h.gen.run(run.id)?.tasks.filter((t) => t.state === "done").length).toBe(1);
    await h.gen.control(run.id, "resume");
    await h.gen.idle();
    expect(h.gen.run(run.id)?.run.state).toBe("done");
    await expect(h.gen.control(run.id, "pause")).rejects.toMatchObject({ code: "E_PRECONDITION" });
  });

  test("cancel SIGINTs the running call, keeps committed blocks, the usage of the stopped call is counted", async () => {
    const router = (call: GenCall, t: Turn): ScriptReply => (isEarly(call) ? { ...validRouter(call, t), hang: true } : validRouter(call, t));
    const h = makeHarness({ router, chunk: 100_000 });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    await tick();
    const c = await h.gen.control(run.id, "cancel");
    expect(c.state).toBe("cancelled");
    await h.gen.idle();
    expect(h.engine.calls.some((x) => x.stopped.includes("user"))).toBe(true);
    const r = h.gen.run(run.id);
    expect(r?.run.state).toBe("cancelled");
    expect(r?.run.usage.calls).toBeGreaterThan(0);
    expect(r?.tasks.every((t) => t.state !== "running")).toBe(true);
    expect(h.gen.active()).toBeNull();
    expect(h.events.events.some((e) => e.type === "gen.run" && e.run.state === "cancelled")).toBe(true);
  });
});

describe("GEN-U-043 warm-first fan-out keys", () => {
  test("tasks sharing system bytes × model × effort share the fanoutKey; Opus is its own group", async () => {
    const h = makeHarness();
    await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    await h.gen.idle();
    const keys = new Map<string, Set<string>>();
    for (const c of h.engine.calls) {
      const k = `${c.call.model}|${c.call.effort}`;
      keys.set(k, (keys.get(k) ?? new Set()).add(c.call.fanoutKey));
    }
    expect([...keys.keys()].sort()).toEqual(["claude-opus-5-5|medium", "claude-sonnet-5-5|low"]);
    for (const set of keys.values()) expect(set.size).toBe(1);
  });
});

describe("GEN-I-020 PT-05 pinned system prompt + repo pack", () => {
  test("(a) one system hash per fan-out group, (b) cache_read ≥ 0.9·P after the first call, (c) even when files change mid-run", async () => {
    const g = gated(isEarly);
    const h = makeHarness({ router: g.router });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    // (c) edit fixture files while the run is in flight (changes the repo pack and the module inputs)
    h.indexer.setFile("src/auth/login.ts", `// edited during the run\n${(await h.indexer.currentText("src/auth/login.ts")) ?? ""}`);
    h.indexer.setFile("src/cli/main.ts", "console.log(1);\n");
    expect(h.indexer.repoPack({ tokenizer: "claude-v5" }).key).not.toBe(h.gen.run(run.id)?.run.pinned?.packKey);
    g.open();
    await h.gen.idle();
    expect(h.gen.run(run.id)?.run.state).toBe("done");
    const groups = new Map<string, typeof h.engine.calls>();
    for (const c of h.engine.calls) groups.set(`${c.call.model}|${c.call.effort}`, [...(groups.get(`${c.call.model}|${c.call.effort}`) ?? []), c]);
    for (const calls of groups.values()) {
      expect(new Set(calls.map((c) => h.hasher.xxh3(c.system))).size).toBe(1); // (a)
      const p = Math.ceil((calls[0]?.system.length ?? 0) / 2.3);
      for (const c of calls.slice(1)) expect(c.usage.cacheRead).toBeGreaterThanOrEqual(0.9 * p); // (b)
    }
    expect(h.gen.run(run.id)?.run.pinned?.systemHash).toBe(h.hasher.sha256(h.engine.calls[0]?.system ?? ""));
  });

  test("a cite of a location shown only in the pinned pack is stamped at the pack's blob, not the edited file", async () => {
    const g = gated(isEarly);
    const j = JSON.stringify;
    const router = (call: GenCall, t: Turn): ScriptReply => {
      if (call.spec.id !== "gen.module" || !call.layout.unit.includes(`module ${M_SESSION}`) || t.attempt !== 1) return g.router(call, t);
      // src/cli/main.ts:1 is an entry fact of the repo pack; the session page's DATA does not show that file
      expect(call.layout.unit).not.toContain("=== src/cli/main.ts");
      return {
        lines: [
          j({ t: "block", id: "new:1", aspect: "responsibility", md: "入口から使われる[[1]]。", claims: { "1": "fact src/cli/main.ts:1" } }),
          j({ t: "block", id: "new:2", aspect: "interface", md: "- 公開する[[1]]。", claims: { "1": "fact src/cli/main.ts:1" } }),
          j({ t: "module", module: M_SESSION, name: "セッション" }),
          j({ t: "end", blocks: 2 }),
        ],
      };
    };
    const h = makeHarness({ router, settings: serial() });
    const pinnedBlob = h.indexer.currentBlob("src/cli/main.ts");
    await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    h.indexer.setFile("src/cli/main.ts", "// edited during the run\nconsole.log(1);\n");
    g.open();
    await h.gen.idle();
    const blk = h.doc.section("s6/session")?.blocks.find((b) => b.aspect === "responsibility");
    expect(h.doc.claims(blk?.id ?? "b_x")[0]?.cites[0]?.blob).toBe(pinnedBlob as string);
    expect(h.indexer.currentBlob("src/cli/main.ts")).not.toBe(pinnedBlob);
  });
});

describe("GEN-U-045 / AC-17 5h yield, GEN-U-046 billing change, window spend, notBefore", () => {
  const win = (u: number) => ({
    fiveHour: { utilization: u, resetsAt: "2026-10-03T05:00:00.000Z" },
    billing: "subscription-window" as const,
    observedAt: "2026-10-03T00:00:00.000Z",
    source: "claude-cli" as const,
  });

  test("background yield pauses the run until the scheduler resumes; boosted tasks keep running", async () => {
    const g = gated(isEarly);
    const h = makeHarness({ router: g.router, settings: serial() });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    h.scheduler.push({ lanePaused: { background: "yield_5h" }, window: win(0.81) });
    expect(h.gen.run(run.id)?.run.paused).toEqual({ reason: "yield_5h", until: "2026-10-03T05:00:00.000Z" });
    h.gen.prioritize("s6/cli");
    g.open();
    await h.gen.idle();
    expect(h.engine.calls.map(target)).toEqual(["gen.overview:early", M_CLI]);
    h.scheduler.push({ lanePaused: { background: null } });
    expect(h.gen.run(run.id)?.run.state).toBe("running");
    await h.gen.idle();
    expect(h.gen.run(run.id)?.run.state).toBe("done");
  });

  test("billing change pauses; resume needs a new estimate", async () => {
    const g = gated(isEarly);
    const h = makeHarness({ router: g.router });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    h.scheduler.push({ lanePaused: { background: "billing_changed" }, window: { ...win(0.2), billing: "overage" } });
    expect(h.gen.run(run.id)?.run.paused?.reason).toBe("billing_changed");
    await expect(h.gen.control(run.id, "resume")).rejects.toMatchObject({ code: "E_PRECONDITION" });
    g.open();
    await h.gen.idle();
    expect((await h.gen.estimate({ effort: "standard" })).confirmReasons).toContain("billing_overage");
  });

  test("one run raising 5h utilization past runWindowSpendPause pauses it (window_spend)", async () => {
    const g = gated(isEarly);
    const h = makeHarness({ router: g.router });
    h.scheduler.push({ window: win(0.1) });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    expect(h.gen.run(run.id)?.run.windowAtStart).toBe(0.1);
    h.scheduler.push({ window: win(0.45) });
    expect(h.gen.run(run.id)?.run.paused?.reason).toBe("window_spend");
    g.open();
    await h.gen.idle();
  });

  test("a scheduler update keeps the run's requested concurrency; a 429 slow-down lowers it", async () => {
    const g = gated(isEarly);
    const h = makeHarness({ router: g.router });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard", concurrency: 5 })).id);
    expect(run.concurrency).toBe(4); // 5 − reserveInteractive
    h.scheduler.push({ effective: 8 });
    expect(h.gen.run(run.id)?.run.concurrency).toBe(4);
    h.scheduler.push({ effective: 3 });
    expect(h.gen.run(run.id)?.run.concurrency).toBe(2);
    h.scheduler.push({ effective: 8 });
    expect(h.gen.run(run.id)?.run.concurrency).toBe(4);
    g.open();
    await h.gen.idle();
  });

  test("notBefore creates the run paused; it starts once the time has come", async () => {
    const h = makeHarness();
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id, { notBefore: "2026-10-03T01:00:00.000Z" });
    expect(run.state).toBe("paused");
    expect(run.paused).toEqual({ reason: "not_before", until: "2026-10-03T01:00:00.000Z" });
    await h.gen.idle();
    expect(h.engine.calls.length).toBe(0);
    h.clock.advance(60 * 60 * 1000);
    h.scheduler.push({});
    await h.gen.idle();
    expect(h.gen.run(run.id)?.run.state).toBe("done");
  });
});

describe("AC-42 daemon restart", () => {
  test("running tasks return to pending, their unlocked partial blocks are removed, the run comes back paused; resuming leaves no duplicates", async () => {
    const router = (call: GenCall, t: Turn): ScriptReply => {
      const r = validRouter(call, t);
      return call.spec.id === "gen.module" && call.layout.unit.includes(`module ${M_SESSION}`) ? { ...r, hang: true, hangAfterLines: 1 } : r;
    };
    const h = makeHarness({ router });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    for (let i = 0; i < 20 && (h.doc.section("s6/session")?.blocks.filter((b) => b.origin === "ai").length ?? 0) === 0; i++) await tick();
    const partial = h.doc.section("s6/session")?.blocks.filter((b) => b.origin === "ai") ?? [];
    expect(partial.length).toBe(1);
    await tick();
    // "restart": a new orchestrator over the same DB / doc / index
    const h2 = makeHarness({ shared: { db: h.db, doc: h.doc, indexer: h.indexer, safe: h.safe, ids: h.ids, clock: h.clock } });
    expect(await h2.gen.recover()).toEqual([run.id]);
    const r = h2.gen.run(run.id);
    expect(r?.run.state).toBe("paused");
    expect(r?.run.paused).toEqual({ reason: "user" });
    expect(r?.tasks.find((t) => t.target.id === M_SESSION)?.state).toBe("pending");
    expect(h.doc.tombstones.has(partial[0]?.id as `b_${string}`)).toBe(true);
    await h2.gen.control(run.id, "resume");
    await h2.gen.idle();
    expect(h2.gen.run(run.id)?.run.state).toBe("done");
    expect(
      h.doc
        .section("s6/session")
        ?.blocks.filter((b) => b.origin === "ai")
        .map((b) => b.aspect),
    ).toEqual(["responsibility", "interface"]);
  });
});
