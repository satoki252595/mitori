/**
 * UX-FIX-10..15 (CR ux-F1) on the real `ComposerSession` against a recording api: a Fix on a doc sentence knows WHICH
 * code it changes before it is estimated — (a) the anchor's cites are the target and the estimate runs, (b) without
 * cites nothing is estimated until the user picks a candidate (sent as `context.add`), (c) with no candidate either the
 * Composer needs an `@` — and in no state does it ask for an estimate that can only answer `412 no code to change`.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { CodeTarget, CodeTargets } from "@mitori/core";
import { installRunes } from "../stores/__tests__/runes.ts";
import type { Stores } from "../stores/app.svelte.ts";

installRunes();
let ComposerSession: typeof import("./session.svelte.ts").ComposerSession;
beforeAll(async () => {
  ({ ComposerSession } = await import("./session.svelte.ts"));
});

const ESTIMATE = {
  route: { mode: "patch", reason: "small_change", model: "claude-sonnet-5-5", effort: "low", tools: "none", contract: "patch/1", requiresConfirm: false },
  estimate: {
    id: "es_1",
    engine: "claude-cli",
    model: "claude-sonnet-5-5",
    inTokens: 2000,
    outTokens: 1500,
    apiUsd: 0.02,
    items: [],
    confidencePct: 25,
    calibrationN: 0,
  },
  bundle: { tokens: 2000, omitted: [] },
};
const T = (path: string, start: number, end: number, source: CodeTarget["source"], symbol?: string): CodeTarget => ({
  path,
  start,
  end,
  label: `${path.split("/").pop()}:${start}-${end}`,
  source,
  tokens: (end - start + 1) * 9,
  ...(symbol ? { symbol } : {}),
});
const LOAD = T("internal/config/config.go", 19, 38, "ref", "Load");
const FETCH = T("internal/meta/fetch.go", 46, 61, "cite", "Client.Fetch");

function fixture(answer: (text: string | undefined) => CodeTargets, intent: "change" | "question" = "change") {
  const calls: { route: string; body: Record<string, unknown> }[] = [];
  const api = {
    async call(route: string, args: { body?: Record<string, unknown> }) {
      calls.push({ route, body: args.body ?? {} });
      if (route === "POST /ws/:ws/jobs/targets") return answer(args.body?.text as string | undefined);
      if (route === "POST /ws/:ws/threads") return { id: "th_draft", version: 1, messages: [] };
      if (route === "PATCH /ws/:ws/threads/:th") return { id: "th_draft", version: 2 };
      if (route === "POST /ws/:ws/jobs/estimate") return ESTIMATE;
      throw new Error(`unexpected ${route}`);
    },
  };
  const s = { api, workspace: { key: "ws_cccccccccccc" }, session: { settings: undefined }, bottom: { toast() {} } } as unknown as Stores;
  const target = {
    block: "b_aaaaaaaa",
    section: "s4",
    anchor: { primary: "doc", doc: { block: "b_aaaaaaaa", selStart: 0, selEnd: 18, quote: { prefix: "", exact: "TSUNDOKU_API_TOKEN", suffix: "" } } },
    text: "TSUNDOKU_API_TOKEN",
    quote: { before: "", mark: "TSUNDOKU_API_TOKEN", after: "" },
    fileLine: null,
    blockHash: "h",
    key: "b_aaaaaaaa:0-18",
    wholeBlock: false,
  };
  const c = new ComposerSession(s, target as never, intent, "push");
  const routes = () => calls.map((x) => x.route);
  return { c, calls, routes };
}
const settle = (ms = 5) => Bun.sleep(ms);

describe("Fix code targets in the Composer (CR ux-F1)", () => {
  test("UX-FIX-10 (a): the anchor's cites are the target — asked on open, then the estimate runs as before", async () => {
    const { c, calls, routes } = fixture(() => ({ cited: [FETCH], candidates: [LOAD] }));
    expect(c.targetsPending).toBe(true);
    await settle();
    expect(calls[0]).toMatchObject({ route: "POST /ws/:ws/jobs/targets", body: { anchor: { primary: "doc" } } });
    expect(c.hasTarget).toBe(true);
    expect(c.needsTarget).toBe(false);
    expect(c.writeFiles).toEqual(["internal/meta/fetch.go"]);
    c.input("TSUNDOKU_API_TOKEN を必須にして");
    await settle();
    await c.refreshEstimate();
    expect(routes()).toContain("POST /ws/:ws/jobs/estimate");
    // the cite is the anchor's own (the router writes it): no context.add for it
    const est = calls.find((x) => x.route === "POST /ws/:ws/jobs/estimate");
    expect(est?.body.context).toBeUndefined();
    c.dispose();
  });

  test("UX-FIX-11 (b): no cite ⇒ no estimate request at all until a candidate is picked; the pick is the context.add range", async () => {
    const { c, calls, routes } = fixture(() => ({ cited: [], candidates: [LOAD] }));
    await settle();
    expect(c.needsTarget).toBe(true);
    expect(c.openCandidates).toEqual([LOAD]);
    c.input("必須にして");
    await settle(); // draft created; its estimate would have been a 412 before
    expect(await c.refreshEstimate()).toBeNull();
    expect(routes()).not.toContain("POST /ws/:ws/jobs/estimate");
    expect(c.estimate).toBeUndefined();
    c.pickTarget(LOAD);
    expect(c.needsTarget).toBe(false);
    expect(c.openCandidates).toEqual([]);
    expect(c.writeFiles).toEqual(["internal/config/config.go"]);
    await c.refreshEstimate();
    const est = calls.find((x) => x.route === "POST /ws/:ws/jobs/estimate");
    expect(est?.body.context).toEqual({ add: [{ path: "internal/config/config.go", start: 19, end: 38 }] });
    c.dispose();
  });

  test("UX-FIX-12 (c): no cite and no candidate ⇒ the Composer needs an @ (no estimate); an @ mention unblocks it", async () => {
    const { c, routes } = fixture(() => ({ cited: [], candidates: [] }));
    await settle();
    expect(c.needsTarget).toBe(true);
    expect(c.openCandidates).toEqual([]);
    c.input("もっと分かりやすく");
    await settle();
    await c.refreshEstimate();
    expect(routes().filter((r) => r === "POST /ws/:ws/jobs/estimate")).toEqual([]);
    c.addMention({ path: "internal/meta/fetch.go", start: 46, end: 61 });
    expect(c.needsTarget).toBe(false);
    await c.refreshEstimate();
    expect(routes()).toContain("POST /ws/:ws/jobs/estimate");
    c.dispose();
  });

  test("UX-FIX-13: the request text re-asks the targets (debounced) while there is no cite — names typed find code", async () => {
    const { c, calls } = fixture((text) => ({ cited: [], candidates: text?.includes("fetchOnce") ? [T("internal/meta/fetch.go", 63, 89, "symbol")] : [] }));
    await settle();
    expect(c.openCandidates).toEqual([]);
    c.input("fetchOnce の再試行をそろえて");
    await settle(450);
    expect(calls.filter((x) => x.route === "POST /ws/:ws/jobs/targets").at(-1)?.body.text).toBe("fetchOnce の再試行をそろえて");
    expect(c.openCandidates.map((t) => t.label)).toEqual(["fetch.go:63-89"]);
    c.dispose();
  });

  test("UX-FIX-14: removing the last picked target drops the estimate (it could only be a 412 now)", async () => {
    const { c } = fixture(() => ({ cited: [], candidates: [LOAD] }));
    await settle();
    c.input("必須にして");
    c.pickTarget(LOAD);
    await settle();
    await c.refreshEstimate();
    expect(c.estimate).toBeDefined();
    c.removeMention(0);
    expect(c.needsTarget).toBe(true);
    expect(c.estimate).toBeUndefined();
    c.dispose();
  });

  test("UX-FIX-15: questions and the doc-target edit never ask for targets (answers need no write scope)", async () => {
    const { c, routes } = fixture(() => ({ cited: [], candidates: [LOAD] }), "question");
    await settle();
    expect(c.wantsTargets).toBe(false);
    expect(routes()).not.toContain("POST /ws/:ws/jobs/targets");
    c.setIntent("change");
    await settle();
    expect(routes()).toContain("POST /ws/:ws/jobs/targets");
    c.fixTarget = "doc";
    expect(c.wantsTargets).toBe(false);
    expect(c.needsTarget).toBe(false);
    c.dispose();
  });
});
