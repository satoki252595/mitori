import { describe, expect, test } from "bun:test";
import { MitoriError, THREAD_TRANSITIONS, type ThreadState, type ThreadTrigger, type TransitionActor } from "@mitori/core";
import { THREAD_TRANSITION_CAUSES } from "../contract.ts";
import { harness } from "./test/fakes.ts";

const STATES: ThreadState[] = ["draft", "open", "queued", "running", "answered", "proposed", "applied", "rejected", "failed", "needs_input", "resolved"];
const TRIGGERS: ThreadTrigger[] = [
  "submit",
  "dispatch",
  "start",
  "answer",
  "propose",
  "ask_human",
  "fail",
  "cancel",
  "accept",
  "reject",
  "revise",
  "retry",
  "reply",
  "agent_done",
  "undo",
  "resolve",
  "reopen",
];
const ACTORS: TransitionActor[] = ["human", "agent", "system"];

describe("AC-L10 thread state machine through ReviewEngine.transition (property: all states × triggers × actors)", () => {
  test("listed ⇒ the table's target; unlisted ⇒ E_STATE_TRANSITION; agents never resolve", () => {
    const { engine, db } = harness();
    let allowed = 0;
    for (const from of STATES) {
      for (const on of TRIGGERS) {
        for (const by of ACTORS) {
          const th = engine.create(
            { anchor: { primary: "code", code: { path: "a.go", start: 1, end: 2 } }, intent: "change", body: "直して", draft: true },
            "human",
          );
          db.run("UPDATE rev_threads SET state = ? WHERE id = ?", [from, th.id]);
          const row = THREAD_TRANSITIONS.find((t) => t.from === from && t.on === on && (t.by as readonly string[]).includes(by));
          let got: string;
          try {
            got = engine.transition(th.id, { on, version: th.version, resolution: "wontfix" }, by).state;
          } catch (e) {
            got = MitoriError.is(e) ? e.code : String(e);
          }
          const want = row ? row.to : "E_STATE_TRANSITION";
          expect(`${from} --${on}/${by}--> ${got}`).toBe(`${from} --${on}/${by}--> ${want}`);
          if (row) allowed++;
          if (on === "resolve" && by === "agent") expect(got).toBe("E_STATE_TRANSITION");
        }
      }
    }
    expect(allowed).toBe(THREAD_TRANSITIONS.reduce((s, t) => s + t.by.length, 0));
  });

  test("every THREAD_TRANSITION_CAUSES row exists in THREAD_TRANSITIONS (incl. the R1 rows of CR loop-1)", () => {
    for (const c of THREAD_TRANSITION_CAUSES) {
      const row = THREAD_TRANSITIONS.find((t) => t.from === c.from && t.on === c.on && t.to === c.to);
      expect(row ? (row.by as readonly string[]).includes(c.by) : `${c.id} missing`).toBe(true);
    }
    expect(THREAD_TRANSITIONS.some((t) => t.from === "proposed" && t.to === "failed" && t.on === "fail")).toBe(true);
    expect(THREAD_TRANSITIONS.some((t) => t.from === "proposed" && t.to === "open" && t.on === "cancel")).toBe(true);
  });

  test("version mismatch ⇒ E_CONFLICT; resolve without a resolution where no default exists ⇒ E_INVALID_INPUT", () => {
    const { engine } = harness();
    const th = engine.create(
      { anchor: { primary: "code", code: { path: "a.go", start: 1, end: 2 } }, intent: "question", body: "なぜ？", draft: false },
      "human",
    );
    expect(() => engine.transition(th.id, { on: "resolve", version: th.version + 5 }, "human")).toThrow(MitoriError);
    try {
      engine.transition(th.id, { on: "resolve", version: th.version }, "human");
    } catch (e) {
      expect(MitoriError.is(e, "E_INVALID_INPUT")).toBe(true);
    }
    const done = engine.transition(th.id, { on: "resolve", version: th.version, resolution: "obsolete" }, "human");
    expect([done.state, done.resolution]).toEqual(["resolved", "obsolete"]);
    const re = engine.transition(th.id, { on: "reopen", version: done.version }, "human");
    expect([re.state, re.resolution]).toEqual(["open", undefined]);
  });
});
