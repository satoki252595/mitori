// gen.* — generation counters (bench/budgets/gen.json) through the in-process daemon and the scenario `claude` of INT-04
// (the real claude-cli engine, normalizer, scheduler and ledger; 0 tokens):
// - counter gen.rerun.engineCalls (max 0): a second standard run over an unchanged repository calls the engine 0 times.
//   The sample of case `gen.rerun` is that rerun's wall time (estimate → done), no budget of its own.
import type { GenEstimate, GenRun, SseEvent, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import type { SseReader } from "../packages/server/src/http/test/sse-reader.ts";
import { FAKE_CLAUDE_CONFIG, type FakeClaude, fakeClaude } from "../test/int/fake-claude.ts";
import { type Int, startInt } from "../test/int/harness.ts";
import { defineBench } from "./runner/define.ts";

interface Rerun {
  int: Int;
  repo: FixtureRepo;
  ws: WorkspaceKey;
  sse: SseReader;
  spawner: FakeClaude;
  /** Engine turns of the reruns (all of them, warm-ups included). */
  calls: number;
}

async function generate(s: Pick<Rerun, "int" | "ws" | "sse">): Promise<GenRun["state"]> {
  const est = await s.int.json<GenEstimate>("POST", `/ws/${s.ws}/gen/estimate`, { effort: "standard" });
  const run = await s.int.json<GenRun>("POST", `/ws/${s.ws}/gen/runs`, { estimateId: est.id, confirm: true });
  const final = (e: SseEvent[]) =>
    e.find(
      (x): x is Extract<SseEvent, { type: "gen.run" }> => x.type === "gen.run" && x.run.id === run.id && ["done", "failed", "cancelled"].includes(x.run.state),
    );
  await s.sse.until((e) => final(e) !== undefined, 120_000);
  return (final(s.sse.events) as Extract<SseEvent, { type: "gen.run" }>).run.state;
}

export const rerun = defineBench<Rerun>({
  id: "gen.rerun",
  suite: "doc",
  mode: "inproc",
  runs: 3,
  warmup: 0,
  async setup() {
    const spawner = fakeClaude({ dtMs: 0, chunkChars: 400 });
    const repo = await buildFixture("go-small");
    const int = await startInt({ spawner, config: FAKE_CLAUDE_CONFIG });
    const ws = (await int.open(repo.root)).ws;
    const sse = await int.sse(ws);
    await sse.until((e) => e.some((x) => x.type === "hello"));
    const s: Rerun = { int, repo, ws, sse, spawner, calls: 0 };
    const first = await generate(s);
    if (first !== "done") throw new Error(`the first generation ended ${first}`);
    if (spawner.turns.length === 0) throw new Error("the first generation never called the engine");
    return s;
  },
  async run(s) {
    const before = s.spawner.turns.length;
    const state = await generate(s);
    s.calls += s.spawner.turns.length - before;
    if (state === "failed") throw new Error("the rerun failed");
  },
  counters: (s) => ({ "gen.rerun.engineCalls": s.calls }),
  async teardown(s) {
    s.sse.close();
    await s.int.close();
    await s.repo.dispose();
  },
});
