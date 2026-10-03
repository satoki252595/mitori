/** Agent-side fakes: a scheduler whose status / window tests drive, and a ledger that records. */
import type { AgentScheduler, UsageLedger } from "@mitori/agent";
import { type PauseReason, type SchedulerStatus, type SubscriptionWindow, type UsageRecord, unsupported } from "@mitori/core";

/** Scheduler fake. */
export interface FakeScheduler extends AgentScheduler {
  /** Push a status / window change to subscribers. */
  push(p: {
    lanePaused?: Partial<Record<"interactive" | "doc" | "background", PauseReason | null>>;
    window?: SubscriptionWindow | null;
    effective?: number;
  }): void;
}

/** Factory. */
export function fakeScheduler(): FakeScheduler {
  let status: SchedulerStatus = {
    concurrency: 3,
    effective: 3,
    running: 0,
    queued: 0,
    yielding: false,
    reservedInteractive: 1,
    lanePaused: { interactive: null, doc: null, background: null },
    resident: { procs: 0, rssMb: 0 },
  };
  let window: SubscriptionWindow | null = null;
  const subs = new Set<(s: SchedulerStatus & { window: SubscriptionWindow | null }) => void>();
  return {
    submit: (req) => unsupported("fakeScheduler.submit", req),
    continueSession: (s) => unsupported("fakeScheduler.continueSession", s),
    prewarm: () => undefined,
    status: () => status,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    window: () => window,
    drain: async () => undefined,
    push(p) {
      status = {
        ...status,
        ...(p.effective !== undefined ? { effective: p.effective } : {}),
        lanePaused: { ...status.lanePaused, ...p.lanePaused },
        yielding: (p.lanePaused?.background ?? status.lanePaused.background) === "yield_5h",
      };
      if (p.window !== undefined) window = p.window;
      for (const cb of subs) cb({ ...status, window });
    },
  };
}

/** Ledger fake (factor 1 until samples are set). */
export interface FakeLedger extends UsageLedger {
  /** Recorded rows. */
  rows: Omit<UsageRecord, "id">[];
  /** Window samples. */
  samples: Parameters<UsageLedger["recordWindowSample"]>[0][];
  /** Set the factor returned for every key. */
  setFactor(f: { factor: number; n: number; accuracyPct: number }): void;
  /** Set κ. */
  setKappa(k: { kappa: number | null; n: number }): void;
}

/** Factory. */
export function fakeLedger(): FakeLedger {
  let factor = { factor: 1, n: 0, accuracyPct: 25 };
  let kappa: { kappa: number | null; n: number } = { kappa: null, n: 0 };
  const rows: Omit<UsageRecord, "id">[] = [];
  const samples: Parameters<UsageLedger["recordWindowSample"]>[0][] = [];
  return {
    rows,
    samples,
    setFactor(f) {
      factor = f;
    },
    setKappa(k) {
      kappa = k;
    },
    record(r) {
      rows.push(r);
      return { ...r, id: `us_${String(rows.length).padStart(12, "0")}` };
    },
    summary: (range) => unsupported("fakeLedger.summary", range),
    factor: () => factor,
    fixedOverhead: () => null,
    windowFactor: () => kappa,
    recordWindowSample(s) {
      samples.push(s);
    },
  };
}
