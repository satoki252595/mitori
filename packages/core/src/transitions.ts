import {
  JOB_TRANSITIONS,
  type JobState,
  THREAD_TRANSITIONS,
  type ThreadState,
  type ThreadTransition,
  type ThreadTrigger,
  type TransitionActor,
} from "./domain.ts";
import { MitoriError } from "./errors.ts";

/** A transition to check against {@link THREAD_TRANSITIONS} or {@link JOB_TRANSITIONS}. */
export type TransitionQuery =
  | {
      /** Thread state machine: rows are (from, on) → to with allowed actors. */
      machine: "thread";
      /** Current state. */
      from: ThreadState;
      /** Trigger. */
      on: ThreadTrigger;
      /** Who fires it (agents can never `resolve`). */
      by: TransitionActor;
    }
  | {
      /** Job state machine: `from` → allowed `to`. */
      machine: "job";
      /** Current state. */
      from: JobState;
      /** Target state. */
      to: JobState;
    };

const THREAD_ROWS = new Map<string, ThreadTransition>(THREAD_TRANSITIONS.map((t) => [`${t.from}\u0000${t.on}`, t]));

/** The row for (from, on) when `by` may fire it, else null. */
export function threadTransition(from: ThreadState, on: ThreadTrigger, by: TransitionActor): ThreadTransition | null {
  const row = THREAD_ROWS.get(`${from}\u0000${on}`);
  return row?.by.includes(by) ? row : null;
}

/** True when the transition is listed (CORE-U-003); anything else is `E_STATE_TRANSITION`. */
export function canTransition(q: TransitionQuery): boolean {
  if (q.machine === "thread") return threadTransition(q.from, q.on, q.by) !== null;
  return (JOB_TRANSITIONS[q.from] as readonly JobState[]).includes(q.to);
}

/** Like {@link canTransition} but throws `E_STATE_TRANSITION`; for threads returns the target state. */
export function assertTransition(q: TransitionQuery): ThreadState | JobState {
  if (q.machine === "thread") {
    const row = threadTransition(q.from, q.on, q.by);
    if (row) return row.to;
    throw new MitoriError("E_STATE_TRANSITION", `thread: ${q.from} --${q.on}/${q.by}--> not allowed`, {
      params: { machine: "thread", from: q.from, on: q.on, by: q.by },
    });
  }
  if (canTransition(q)) return q.to;
  throw new MitoriError("E_STATE_TRANSITION", `job: ${q.from} --> ${q.to} not allowed`, { params: { machine: "job", from: q.from, to: q.to } });
}
