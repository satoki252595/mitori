// Synthetic cases: the harness's own acceptance material (MILESTONES WP-12: a benchmark made 25 % slower must fail the
// compare gate). They are excluded from `--suite all`; select them with `--suite synthetic`.
// Environment knobs (so one checkout can play both base and head — `compare --head-env`):
//   MITORI_BENCH_SLOWDOWN=1.25    synthetic.spin takes 25 % longer
//   MITORI_BENCH_EXTRA_CALLS=1    synthetic.counter reports one more call
//   MITORI_BENCH_VALUE=300        synthetic.value reports 300 (a structural count)
import { defineBench } from "./define.ts";

/** 20 ms: a 25 % slowdown (5 ms) must clear the compare gate's 2 ms noise floor. */
const BASE_MS = 20;
const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
};

/** Busy-wait: the duration is exact, so the case has almost no variance of its own. */
function spin(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* spin */
  }
}

export const spinCase = defineBench({
  id: "synthetic.spin",
  suite: "synthetic",
  mode: "inproc",
  runs: 9,
  warmup: 1,
  run: () => spin(BASE_MS * num("MITORI_BENCH_SLOWDOWN", 1)),
});

/** Alternates between a short and a long run: cv ≈ 0.6, so the gate must call it noisy instead of failing it. */
export const noisyCase = defineBench<{ n: number }>({
  id: "synthetic.noisy",
  suite: "synthetic",
  mode: "inproc",
  runs: 8,
  warmup: 0,
  setup: () => ({ n: 0 }),
  run: (s) => spin((s.n++ % 2 === 0 ? 4 : 30) * num("MITORI_BENCH_SLOWDOWN", 1)),
});

export const counterCase = defineBench({
  id: "synthetic.counter",
  suite: "synthetic",
  mode: "inproc",
  runs: 3,
  warmup: 0,
  run: () => spin(0.2),
  counters: () => ({ "synthetic.parseCalls": num("MITORI_BENCH_EXTRA_CALLS", 0) }),
});

/** A value-reporting, machine-independent case (counts, bytes): the structural gate. */
export const valueCase = defineBench({
  id: "synthetic.value",
  suite: "synthetic",
  mode: "inproc",
  unit: "count",
  runs: 3,
  warmup: 0,
  run: () => num("MITORI_BENCH_VALUE", 100),
});
