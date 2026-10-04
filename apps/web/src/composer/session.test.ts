/**
 * LIVE-02 on the real `ComposerSession` (rune module compiled for the test), against a recording `api`: the estimate is
 * made for the text the server HAS. The Composer autosaves the draft 500 ms after the last key and re-estimates after
 * 300 ms, so the estimate used to be made for the previous text (empty after an `@` mention opened the draft) and the
 * send reused that plan — the real claude answered "the ASK body was empty".
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { installRunes } from "../stores/__tests__/runes.ts";
import type { Stores } from "../stores/app.svelte.ts";

installRunes();
let ComposerSession: typeof import("./session.svelte.ts").ComposerSession;
beforeAll(async () => {
  ({ ComposerSession } = await import("./session.svelte.ts"));
});

const ESTIMATE = {
  route: {
    mode: "answer",
    reason: "intent_question",
    model: "claude-sonnet-5-5",
    effort: "low",
    tools: "none",
    contract: "answer/1",
    requiresConfirm: false,
    anchoredLines: 1,
    files: 0,
  },
  estimate: {
    id: "es_1",
    engine: "claude-cli",
    model: "claude-sonnet-5-5",
    inTokens: 900,
    outTokens: 600,
    apiUsd: 0.01,
    items: [],
    confidencePct: 25,
    calibrationN: 0,
  },
  bundle: { tokens: 900, omitted: [] },
};

function fixture(estimateMs = 0) {
  const calls: { route: string; body: unknown }[] = [];
  const api = {
    async call(route: string, args: { body?: unknown }) {
      calls.push({ route, body: args.body });
      if (route === "POST /ws/:ws/jobs/estimate" && estimateMs > 0) await Bun.sleep(estimateMs);
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
    anchor: { primary: "doc", doc: { block: "b_aaaaaaaa", blockHash: "h", quote: { prefix: "", exact: "x", suffix: "" } } },
    text: "x",
    quote: { before: "", mark: "x", after: "" },
    fileLine: null,
    blockHash: "h",
    key: "b_aaaaaaaa:0-1",
    wholeBlock: false,
  };
  const c = new ComposerSession(s, target as never, "question", "push");
  return { c, calls };
}

describe("LIVE-02 the estimate follows the saved text", () => {
  test("text typed after the draft exists is PATCHed before the estimate is asked", async () => {
    const { c, calls } = fixture();
    c.addMention({ path: "internal/meta/fetch.go", start: 46, end: 61 }); // opens the draft with an empty body
    await Bun.sleep(5);
    expect(calls[0]?.body).toMatchObject({ body: "", draft: true });
    const n = calls.length;
    c.input("この再試行は最大何回ですか？");
    await c.refreshEstimate(); // what the 300 ms debounce runs — the 500 ms save has not fired yet
    expect(calls.slice(n).map((x) => x.route)).toEqual(["PATCH /ws/:ws/threads/:th", "POST /ws/:ws/jobs/estimate"]);
    expect(calls[n]?.body).toMatchObject({ body: "この再試行は最大何回ですか？" });
    expect(c.stale).toBe(false);
    c.dispose();
  });

  test("typing on while the estimate is in flight leaves the Composer stale (a send re-estimates)", async () => {
    const { c } = fixture(40);
    c.addMention({ path: "internal/meta/fetch.go", start: 46, end: 61 });
    await Bun.sleep(60); // draft created, its first estimate done
    c.input("a");
    const running = c.refreshEstimate(); // saves "a", then waits 40 ms for the server
    await Bun.sleep(20);
    c.input("ab"); // while the estimate for "a" is in flight
    await running;
    expect(c.stale).toBe(true);
    c.dispose();
  });
});

describe("EX-06 「AI に設計書を直させる」", () => {
  test("the AI doc fix is an Explain with docFix: the draft is a question, the estimate asks kind explain + docFix", async () => {
    const { c, calls } = fixture();
    c.setIntent("change");
    await c.setTarget("ai");
    expect(c.kind).toBe("explain");
    expect(c.sentIntent).toBe("question");
    expect(c.docFix).toBe(true);
    expect(c.wantsTargets).toBe(false); // no code to pick: the code is the truth here
    c.input("この文は間違っている。GET は常に通す。");
    await Bun.sleep(5); // the draft is created
    await c.refreshEstimate();
    expect(calls.find((x) => x.route === "POST /ws/:ws/threads")?.body).toMatchObject({ intent: "question", draft: true });
    expect(calls.filter((x) => x.route === "POST /ws/:ws/jobs/estimate").at(-1)?.body).toMatchObject({ kind: "explain", docFix: true });
    // back to "make the code follow": a change again, no docFix
    await c.setTarget("code");
    expect([c.kind, c.sentIntent, c.docFix]).toEqual(["fix", "change", false]);
    c.dispose();
  });
});
