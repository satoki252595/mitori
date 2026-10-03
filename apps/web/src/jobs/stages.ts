/**
 * Job-card stage reducer (ux.md §6.4, JUDGEMENT §6.6): the planned rows of `planStages` advance only on real
 * `JobEvent`s — `phase` moves the cursor (✓ + elapsed on the row it leaves), `gate` settles one gate row, `tool`
 * rewrites the read / edit detail, `text` streams the answer. Repairs and re-runs ADD rows; nothing is removed and
 * nothing is invented (no % bar, no time-left guess — WEB-U-032). Pure.
 */
import type { ExecMode, GateResult, JobEvent, JobState } from "@mitori/core";
import { PHASE_TO_STAGE, type StageKey, type StageRow } from "../contract.ts";

export interface StageView {
  /** Rows, in display order. */
  rows: StageRow[];
  /** Latest event line (`Read internal/x.go`, `ops[1] a.go 575–608 replace`). */
  tail: string | null;
  /** Streamed answer text so far (answer mode). */
  answer: string;
  /** Time to first token of the engine run, when reported. */
  ttftMs: number | null;
}

const OPEN: ReadonlySet<StageRow["state"]> = new Set(["planned", "now"]);

function gateState(g: GateResult): StageRow["state"] {
  if (g.status === "pass") return "done";
  if (g.status === "fail" || g.status === "error" || g.status === "timeout") return "failed";
  return "skipped";
}

/** `fold` keeps the cursor on the row that is `now` (or the last row that finished). */
class Folder {
  rows: StageRow[];
  cursor: number;

  constructor(plan: readonly StageRow[]) {
    this.rows = plan.map((r) => ({ ...r }));
    let last = -1;
    this.rows.forEach((r, i) => {
      if (r.state === "done" || r.state === "now") last = i;
    });
    this.cursor = last;
  }

  #closeNow(atMs: number): void {
    const cur = this.rows[this.cursor];
    if (cur?.state === "now") this.rows[this.cursor] = { ...cur, state: "done", atMs };
  }

  /** Move to the next open row of `key` (skipping planned rows in between), or add one right after the cursor. */
  advance(key: StageKey, atMs: number, detail: string | undefined, gate?: string): void {
    const cur = this.rows[this.cursor];
    // repeated phase (agent `read` per file): same row, newer detail
    if (cur && cur.state === "now" && cur.key === key && (gate === undefined || cur.gate === undefined || cur.gate === gate)) {
      if (detail) this.rows[this.cursor] = { ...cur, detail };
      return;
    }
    let i = -1;
    for (let j = this.cursor + 1; j < this.rows.length; j++) {
      const r = this.rows[j] as StageRow;
      if (r.key === key && OPEN.has(r.state) && (gate === undefined || r.gate === undefined || r.gate === gate)) {
        i = j;
        break;
      }
    }
    this.#closeNow(atMs);
    if (i < 0) {
      i = this.cursor + 1;
      this.rows.splice(i, 0, { key, state: "now", ...(gate ? { gate } : {}), ...(detail ? { detail } : {}) });
    } else {
      for (let j = this.cursor + 1; j < i; j++) {
        const r = this.rows[j] as StageRow;
        if (r.state === "planned") this.rows[j] = { ...r, state: "skipped" };
      }
      const r = this.rows[i] as StageRow;
      this.rows[i] = { ...r, state: "now", ...(gate ? { gate } : {}), ...(detail ? { detail } : {}) };
    }
    this.cursor = i;
  }

  /** A gate finished: settle its row (the `now` gate row, an open row of that gate, or a new row). */
  gate(g: GateResult, atMs: number): void {
    const cur = this.rows[this.cursor];
    if (!(cur && cur.key === "gate" && cur.state === "now" && (cur.gate === undefined || cur.gate === g.gate))) this.advance("gate", atMs, undefined, g.gate);
    const r = this.rows[this.cursor] as StageRow;
    this.rows[this.cursor] = { ...r, gate: g.gate, state: gateState(g), atMs };
    // the next planned gate (if any) starts now; otherwise the cursor stays on this settled row
    const next = this.rows[this.cursor + 1];
    if (next && next.key === "gate" && next.state === "planned") {
      this.rows[this.cursor + 1] = { ...next, state: "now" };
      this.cursor++;
    }
  }

  /** Update the detail of the row in progress. */
  detail(text: string): void {
    const cur = this.rows[this.cursor];
    if (cur?.state === "now") this.rows[this.cursor] = { ...cur, detail: text };
  }

  finish(key: StageKey, atMs: number): void {
    this.advance(key, atMs, undefined);
    const r = this.rows[this.cursor] as StageRow;
    this.rows[this.cursor] = { ...r, state: "done", atMs };
    // anything still planned after the terminal row did not happen
    for (let j = this.cursor + 1; j < this.rows.length; j++) {
      const x = this.rows[j] as StageRow;
      if (x.state === "planned") this.rows[j] = { ...x, state: "skipped" };
    }
  }

  fail(atMs: number, state: "failed" | "skipped"): void {
    const cur = this.rows[this.cursor];
    if (cur?.state === "now") this.rows[this.cursor] = { ...cur, state, atMs };
    else {
      const nextOpen = this.rows.findIndex((r, j) => j > this.cursor && r.state === "planned");
      if (nextOpen >= 0) this.rows[nextOpen] = { ...(this.rows[nextOpen] as StageRow), state, atMs };
    }
  }
}

const TERMINAL_OK: Partial<Record<JobState, StageKey>> = {
  ready: "ready",
  accepting: "ready",
  accepted: "ready",
  partially_accepted: "ready",
  rejected: "ready",
  reverted: "ready",
  done: "done",
};

/**
 * Fold the events of one job into its planned rows. `t0` = job start (UnixMs) for the elapsed column; `endMs` = when
 * the job reached `state` (finishedAt), used for the terminal row. In patch mode an `edit` phase folds into `apply`.
 */
export function foldStages(
  plan: readonly StageRow[],
  mode: ExecMode,
  events: readonly JobEvent[],
  t0: number,
  state: JobState,
  endMs: number | null = null,
): StageView {
  const f = new Folder(plan);
  let tail: string | null = null;
  let answer = "";
  let ttftMs: number | null = null;
  let last = t0;
  for (const e of events) {
    const at = Math.max(0, e.at - t0);
    last = Math.max(last, e.at);
    switch (e.t) {
      case "phase": {
        if (e.phase === "queued") break;
        let key = PHASE_TO_STAGE[e.phase];
        if (mode === "patch" && key === "edit") key = "apply";
        if (key === "ready" || key === "done") f.finish(key, at);
        else f.advance(key, at, e.detail ?? (e.target ? e.target : undefined));
        if (e.detail) tail = e.detail;
        break;
      }
      case "tool": {
        const line = e.target ? `${e.name} ${e.target}` : e.name;
        tail = line;
        if (e.status === "start") f.detail(line);
        break;
      }
      case "text":
        answer += e.delta;
        break;
      case "gate":
        f.gate(e.gate, at);
        break;
      case "result":
        if (e.ttftMs !== undefined) ttftMs = e.ttftMs;
        if (!answer && e.text) answer = e.text;
        break;
      case "error":
        tail = `${e.code} · ${e.message}`;
        break;
      default:
        break;
    }
  }
  const end = Math.max(0, (endMs ?? last) - t0);
  const ok = TERMINAL_OK[state];
  if (ok) {
    const done = f.rows.some((r) => r.key === ok && r.state === "done");
    if (!done) f.finish(ok, end);
  } else if (state === "failed") f.fail(end, "failed");
  else if (state === "cancelled") f.fail(end, "skipped");
  return { rows: f.rows, tail, answer, ttftMs };
}

/** Prior duration bands (seconds) until 20 jobs of the same intent × mode exist (ux.md §6.4 [仮]). */
export const USUAL_PRIOR_SEC = { answer: { lo: 4, hi: 8 }, patch: { lo: 11, hi: 17 }, agent: { lo: 25, hi: 40 } } as const satisfies Record<
  ExecMode,
  { lo: number; hi: number }
>;

/** 「通常 {p25}–{p75} 秒」: the measured band when ≥ 20 samples exist, else the prior (n = 0). */
export function usualBand(mode: ExecMode, history: { p25: number; p75: number; n: number } | undefined): { lo: number; hi: number; n: number } {
  if (history && history.n >= 20) return { lo: Math.round(history.p25), hi: Math.round(history.p75), n: history.n };
  return { ...USUAL_PRIOR_SEC[mode], n: 0 };
}
