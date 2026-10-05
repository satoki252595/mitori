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
let Loop: typeof import("../threads/loop.svelte.ts").Loop;
beforeAll(async () => {
  ({ ComposerSession } = await import("./session.svelte.ts"));
  ({ Loop } = await import("../threads/loop.svelte.ts"));
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

function fixture(estimateMs = 0, draftWait?: Promise<void>) {
  const calls: { route: string; body: unknown; ws: string | undefined }[] = [];
  const api = {
    async call(route: string, args: { body?: unknown; params?: { ws?: string } }) {
      calls.push({ route, body: args.body, ws: args.params?.ws });
      if (route === "POST /ws/:ws/jobs/estimate" && estimateMs > 0) await Bun.sleep(estimateMs);
      if (route === "POST /ws/:ws/threads") {
        if (draftWait) await draftWait;
        return { id: "th_draft", version: 1, messages: [] };
      }
      if (route === "PATCH /ws/:ws/threads/:th") return { id: "th_draft", version: 2 };
      if (route === "POST /ws/:ws/jobs/estimate") return ESTIMATE;
      if (route === "POST /ws/:ws/prompt") return { text: "prompt", tokens: 100 };
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
  return { c, calls, s };
}

describe("LIVE-02 the estimate follows the saved text", () => {
  test("a draft POST pending during a workspace switch keeps its following PATCH in the originating workspace", async () => {
    let release!: () => void;
    const draftWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { c, calls, s } = fixture(0, draftWait);
    const original = s.workspace.key;
    c.input("保存を始める");
    const saving = c.flushSave();
    expect(calls[0]).toMatchObject({ route: "POST /ws/:ws/threads", ws: original, body: { body: "保存を始める", draft: true } });
    c.input("待機中の変更も保持する");
    s.workspace.key = "ws_dddddddddddd";
    release();
    await saving;
    expect(c.ws).toBe(original);
    expect(calls.find((call) => call.route === "PATCH /ws/:ws/threads/:th")).toMatchObject({ ws: original, body: { body: "待機中の変更も保持する" } });
    expect(calls.every((call) => call.ws === original)).toBe(true);
    c.dispose();
  });

  test("switching workspace during submit saves the original draft and leaves the new Composer and review untouched", async () => {
    let release!: () => void;
    const draftWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { c, calls, s } = fixture(0, draftWait);
    s.review = { threads: new Map(), jobs: new Map(), round: null } as unknown as Stores["review"];
    const original = c.ws;
    if (original === null) throw new Error("fixture requires a workspace");
    const loop = new Loop(s);
    const g = globalThis as unknown as Record<string, unknown>;
    const previousCss = g.CSS;
    const previousFrame = g.requestAnimationFrame;
    g.CSS = { highlights: new Map() };
    g.requestAnimationFrame = (fn: FrameRequestCallback) => {
      fn(0);
      return 0;
    };
    let next: InstanceType<typeof ComposerSession> | undefined;
    try {
      c.input("元のworkspaceの依頼");
      const submitting = loop.submit(c);
      expect(loop.pending.size).toBe(1);
      s.workspace.key = "ws_dddddddddddd";
      s.review.threads.clear();
      s.review.jobs.clear();
      next = new ComposerSession(s, c.target, "question", "push");
      loop.composer = next;
      release();
      await submitting;
      expect(c.save).toBe("saved");
      expect(c.draft).toBe("th_draft");
      expect(loop.composer).toBe(next);
      expect(s.review.threads.size).toBe(0);
      expect(s.review.jobs.size).toBe(0);
      expect(calls.map((call) => call.route)).toEqual(["POST /ws/:ws/threads"]);
      expect(calls[0]?.ws).toBe(original);
      await loop.submit(c);
      expect(calls).toHaveLength(1);
      expect(loop.composer).toBe(next);
    } finally {
      release();
      c.dispose();
      next?.dispose();
      g.CSS = previousCss;
      g.requestAnimationFrame = previousFrame;
    }
  });

  test("before a server estimate, question/change predictions use their configured answer/patch model", () => {
    for (const [intent, role, other] of [
      ["question", "answer", "patch"],
      ["change", "patch", "answer"],
    ] as const) {
      const { c, s, calls } = fixture();
      s.session.settings = {
        settings: {
          defaultEngine: "generic",
          models: { [role]: "generic:muse-spark-1.3-contributor", [other]: "claude-sonnet-5-5" },
          engines: { generic: { pricing: { inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0.002 } } },
        },
      } as never;
      c.intent = intent;
      c.body = "Read the existing code.";
      expect(c.estimate).toBeUndefined();
      expect(c.predicted.usd).toBeCloseTo((c.predicted.tokensIn * 0.1) / 1e6, 6);
      expect(c.predicted.usd).toBeGreaterThan(0);
      expect(calls).toHaveLength(0);
      c.dispose();
    }
  });

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
    expect(c.predicted.usd).toBe(ESTIMATE.estimate.apiUsd);
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

describe("CR safe-6 context on every path", () => {
  test("narrowing a submitted confirm card PATCHes context without a draft-only body", async () => {
    const { c, calls } = fixture();
    c.input("依頼");
    await c.flushSave();
    c.submitted = true;
    c.addMention({ path: "a.ts", start: 1, end: 3 });
    await c.flushSave();
    const patch = calls.filter((x) => x.route === "PATCH /ws/:ws/threads/:th").at(-1)?.body;
    expect(patch).toMatchObject({ context: { add: [{ path: "a.ts", start: 1, end: 3 }] } });
    expect(patch).not.toHaveProperty("body");
    c.dispose();
  });

  test("the loop's copy prompt sends the same context that was stored on the draft", async () => {
    const { c, calls, s } = fixture();
    c.addMention({ path: "a.ts", start: 1, end: 3 });
    c.toggleWrite("b.ts");
    await c.flushSave();
    c.dispose();
    await new Loop(s).copyPrompt(c.target.anchor as never, "依頼", c.intent, c.context);
    expect(calls.find((x) => x.route === "POST /ws/:ws/prompt")?.body).toMatchObject({
      ask: "依頼",
      context: { add: [{ path: "a.ts", start: 1, end: 3 }], remove: ["write:b.ts"] },
    });
  });

  test("changing context while an estimate is in flight keeps the Composer stale", async () => {
    const { c } = fixture(40);
    c.addMention({ path: "a.ts", start: 1, end: 3 });
    await Bun.sleep(60);
    const running = c.refreshEstimate();
    await Bun.sleep(20);
    c.addMention({ path: "b.ts", start: 4, end: 5 });
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
