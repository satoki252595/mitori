import { describe, expect, test } from "bun:test";
import { JOB_TRANSITIONS, type JobState, THREAD_TRANSITIONS, type ThreadState, type ThreadTrigger, type TransitionActor } from "./domain.ts";
import { MitoriError } from "./errors.ts";
import { assertTransition, canTransition, threadTransition } from "./transitions.ts";

const THREAD_STATES: ThreadState[] = ["draft", "open", "queued", "running", "answered", "proposed", "applied", "rejected", "failed", "needs_input", "resolved"];
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
const JOB_STATES = Object.keys(JOB_TRANSITIONS) as JobState[];

describe("CORE-U-003 canTransition", () => {
  test("(from, on) is unique in THREAD_TRANSITIONS", () => {
    const keys = THREAD_TRANSITIONS.map((t) => `${t.from}/${t.on}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("thread: every (state, trigger, actor) is allowed iff a row lists it", () => {
    for (const from of THREAD_STATES)
      for (const on of TRIGGERS)
        for (const by of ACTORS) {
          const row = THREAD_TRANSITIONS.find((t) => t.from === from && t.on === on);
          const listed = row !== undefined && (row.by as readonly TransitionActor[]).includes(by);
          expect(canTransition({ machine: "thread", from, on, by })).toBe(listed);
          expect(threadTransition(from, on, by)?.to ?? null).toBe(listed ? (row?.to ?? null) : null);
        }
  });

  test("agents can never resolve", () => {
    for (const from of THREAD_STATES) expect(canTransition({ machine: "thread", from, on: "resolve", by: "agent" })).toBe(false);
  });

  test("job: every (from, to) is allowed iff listed", () => {
    for (const from of JOB_STATES)
      for (const to of JOB_STATES) expect(canTransition({ machine: "job", from, to })).toBe((JOB_TRANSITIONS[from] as readonly JobState[]).includes(to));
  });

  test("assertTransition returns the target or throws E_STATE_TRANSITION", () => {
    expect(assertTransition({ machine: "thread", from: "draft", on: "submit", by: "human" })).toBe("open");
    expect(assertTransition({ machine: "job", from: "queued", to: "preparing" })).toBe("preparing");
    for (const q of [
      { machine: "thread", from: "open", on: "resolve", by: "agent" },
      { machine: "job", from: "done", to: "queued" },
    ] as const) {
      try {
        assertTransition(q);
        throw new Error("unreachable");
      } catch (e) {
        expect(MitoriError.is(e, "E_STATE_TRANSITION")).toBe(true);
      }
    }
  });
});
