import { expect, test } from "bun:test";
import type { ApiClient } from "@mitori/client";
import { type GenEstimate, type GenRun, MitoriError, type SectionId, type WorkspaceKey } from "@mitori/core";
import { installRunes } from "../stores/__tests__/runes.ts";

installRunes();
const { GenState } = await import("../stores/gen.svelte.ts");

const WS = "ws_000000000000" as WorkspaceKey;
const SECTION = "s1" as SectionId;
const estimate = (id = "es_0000000001") => ({ id, engine: "claude-cli", effort: "standard" }) as GenEstimate;
const run = (id = "gr_0000000001") => ({ id, state: "done" }) as GenRun;

interface Call {
  route: string;
  params: Record<string, string>;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}

function setup(reply: (call: Call) => unknown | Promise<unknown>) {
  let ws: WorkspaceKey | null = WS;
  const calls: Call[] = [];
  const api = {
    call(route: string, options: Omit<Call, "route">) {
      const call = { route, ...options };
      calls.push(call);
      return Promise.resolve().then(() => reply(call));
    },
  } as unknown as ApiClient;
  return { gen: new GenState(api, () => ws), calls, setWs: (next: WorkspaceKey | null) => (ws = next) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("cold estimate actions capture the engine before import; switching effort uses the three cached estimates", async () => {
  const { gen, calls } = setup((call) => estimate(`es_${call.body?.effort}`));
  gen.engine = "generic";
  const loading = gen.loadEstimates();
  gen.engine = "codex-cli";
  await loading;
  expect(calls.map((call) => call.body)).toEqual([
    { effort: "overview", engine: "generic" },
    { effort: "standard", engine: "generic" },
    { effort: "complete", engine: "generic" },
  ]);
  expect(gen.estimates.size).toBe(3);
  expect(gen.estimates.get(gen.key("overview", "generic"))?.id).toBe("es_overview");
  gen.setEffort("complete");
  expect(gen.effortChosen).toBe(true);
  expect(calls).toHaveLength(3);
});

test("an expired estimate refreshes without starting; the next human click retains confirmation and idempotency", async () => {
  let starts = 0;
  const { gen, calls } = setup((call) => {
    if (call.route.endsWith("estimate")) return estimate(`es_${call.body?.effort}`);
    if (++starts === 1) throw new MitoriError("E_PRECONDITION", "estimate expired");
    return run();
  });
  gen.estimates.set(gen.key("standard"), estimate());
  const first = gen.start();
  expect(gen.starting).toBe(true);
  expect(await first).toBe("refreshed");
  expect(starts).toBe(1);
  expect(gen.run).toBeNull();
  expect(gen.starting).toBe(false);
  expect(await gen.start({ notBefore: "2026-10-05T12:00:00Z" })).toBe("started");
  expect(starts).toBe(2);
  expect(calls.at(-1)).toMatchObject({
    params: { ws: WS },
    body: { estimateId: "es_standard", confirm: true, notBefore: "2026-10-05T12:00:00Z" },
    idempotencyKey: "gen-es_standard",
  });
});

test("section generation still requires the first estimate click and a separate confirmed run", async () => {
  const { gen, calls } = setup((call) => (call.route.endsWith("estimate") ? estimate() : run()));
  expect(await gen.runSection(SECTION)).toBe(false);
  expect(calls).toHaveLength(0);
  gen.setEffort("overview");
  const first = gen.estimateSection(SECTION);
  gen.setEffort("complete");
  expect(await first).toEqual(estimate());
  expect(calls[0]?.body).toEqual({ effort: "overview", scope: [SECTION] });
  expect(gen.run).toBeNull();
  expect(await gen.runSection(SECTION)).toBe(true);
  expect(calls[1]).toMatchObject({ body: { estimateId: estimate().id, confirm: true }, idempotencyKey: `gen-${estimate().id}` });
  expect(gen.sectionEstimates.has(SECTION)).toBe(false);
});

test("workspace changes during the cold import send no estimate or priority request", async () => {
  const { gen, calls, setWs } = setup(() => estimate());
  const estimates = gen.loadEstimates();
  const priority = gen.prioritize(SECTION);
  setWs("ws_000000000001" as WorkspaceKey);
  await estimates;
  expect(await priority).toBe(false);
  expect(calls).toHaveLength(0);
});

test("reset invalidates a late start even after returning to the same workspace and preserves a newer pending start", async () => {
  const oldEntered = deferred<void>();
  const newEntered = deferred<void>();
  const oldRun = deferred<GenRun>();
  const newRun = deferred<GenRun>();
  const { gen, setWs } = setup((call) => {
    if (call.body?.estimateId === "es_old") {
      oldEntered.resolve();
      return oldRun.promise;
    }
    newEntered.resolve();
    return newRun.promise;
  });
  gen.estimates.set(gen.key("standard"), estimate("es_old"));
  const oldStart = gen.start();
  await oldEntered.promise;
  setWs("ws_000000000001" as WorkspaceKey);
  gen.reset();
  expect(gen.starting).toBe(false);
  setWs(WS);
  gen.estimates.set(gen.key("standard"), estimate("es_new"));
  const nextStart = gen.start();
  await newEntered.promise;
  oldRun.resolve(run("gr_old"));
  expect(await oldStart).toBe("failed");
  expect(gen.run).toBeNull();
  expect(gen.starting).toBe(true);
  newRun.resolve(run("gr_new"));
  expect(await nextStart).toBe("started");
  expect(gen.run?.id).toBe("gr_new");
  expect(gen.starting).toBe(false);
});

test("late section estimates and control replies cannot overwrite synchronous SSE state after reset", async () => {
  const entered = deferred<void>();
  const answer = deferred<GenEstimate>();
  const { gen } = setup(() => {
    entered.resolve();
    return answer.promise;
  });
  const loading = gen.estimateSection(SECTION);
  await entered.promise;
  gen.reset();
  gen.applyRun(run("gr_new"));
  answer.resolve(estimate());
  expect(await loading).toBeNull();
  expect(gen.sectionEstimates.size).toBe(0);
  expect(gen.run?.id).toBe("gr_new");
  expect(gen.error).toBeNull();

  const controlEntered = deferred<void>();
  const result = deferred<GenRun>();
  const control = setup(() => {
    controlEntered.resolve();
    return result.promise;
  }).gen;
  control.applyRun(run("gr_old"));
  const pausing = control.control("pause");
  await controlEntered.promise;
  control.reset();
  control.applyRun(run("gr_new"));
  result.resolve(run("gr_old"));
  await pausing;
  expect(control.run?.id).toBe("gr_new");
});
