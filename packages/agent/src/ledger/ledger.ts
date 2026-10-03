import {
  CALIBRATION,
  type Clock,
  type EmaState,
  type EngineId,
  emaUpdate,
  type Logger,
  type ModelId,
  newId,
  type Random,
  type SqlDb,
  type SubscriptionWindow,
  type UsageRange,
  type UsageRecord,
  type UsageSummary,
  type UsageTotals,
  type WorkspaceKey,
  type WriteQueue,
  type Xxh3,
} from "@mitori/core";
import type { UsageLedger } from "../contract.ts";

export interface LedgerDeps {
  /** state.sqlite (reads; writes only inside `stateWrite`). */
  db: SqlDb;
  /** The daemon-wide writer of state.sqlite [CONS-03]. */
  stateWrite: WriteQueue;
  random: Random;
  clock: Clock;
  log: Logger;
}

/** The ledger plus bridge-internal entry points. */
export interface UsageLedgerImpl extends UsageLedger {
  /** One fixed-overhead sample (tokens) of a profile. */
  recordOverhead(profileKey: Xxh3, tokens: number): void;
  /** Resolves when every queued write reached the database. */
  flush(): Promise<void>;
}

interface CalState {
  ema: EmaState;
  samples?: number[];
}

/** κ acceptance (gen spec §9.4): run ≥ $0.3, `resetsAt` unchanged, 0 ≤ κ ≤ 1; median of the last 10. */
const KAPPA = { minUsd: 0.3, keep: 10, minN: 3 } as const;
const OVERHEAD_CLAMP = [1, 1_000_000] as const;
const MISMATCH = 0.05;
const DAY_MS = 86_400_000;

const callKey = (k: { engine: EngineId; promptId: string; model: ModelId }): string => `call:${k.engine}:${k.promptId}:${k.model}`;
const overheadKey = (profileKey: Xxh3): string => `overhead:${profileKey}`;

const emptyTotals = (): UsageTotals => ({ calls: 0, in: 0, cacheWrite: 0, cacheRead: 0, out: 0, apiUsd: 0 });

/** Local calendar day `YYYY-MM-DD` (the daemon's time zone). */
const dayOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const localMidnight = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

interface Row {
  at_ms: number;
  engine: string;
  model: string;
  in_tok: number;
  cache_write: number;
  cache_read: number;
  out_tok: number;
  api_usd: number;
}

export function createUsageLedger(deps: LedgerDeps): UsageLedgerImpl {
  const log = deps.log.child("agent.ledger");
  const pending = new Set<UsageRecord>();
  const inflight = new Set<Promise<unknown>>();
  let cal: Map<string, CalState> | null = null;
  let lastWindow: SubscriptionWindow | null = null;

  const calibration = (): Map<string, CalState> => {
    if (cal) return cal;
    cal = new Map();
    for (const r of deps.db.all<{ key: string; value: number; n: number; mad: number; samples: string | null }>(
      "SELECT key, value, n, mad, samples FROM use_calibration",
    )) {
      const st: CalState = { ema: { value: r.value, n: r.n, mad: r.mad } };
      if (r.samples) st.samples = JSON.parse(r.samples) as number[];
      cal.set(r.key, st);
    }
    return cal;
  };

  const write = (label: string, fn: () => void, onDone?: () => void): void => {
    const p = deps.stateWrite(label, fn).then(
      () => onDone?.(),
      (err: unknown) => {
        onDone?.();
        log.error("agent.ledger.write_failed", { label, err: err instanceof Error ? err.message : String(err) });
      },
    );
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  };

  const saveCal = (key: string, st: CalState): void => {
    calibration().set(key, st);
    const at = deps.clock.now();
    write("use.calibration", () =>
      deps.db.run(
        "INSERT INTO use_calibration (key, value, n, mad, samples, updated_ms) VALUES ($k, $v, $n, $m, $s, $u) ON CONFLICT(key) DO UPDATE SET value = excluded.value, n = excluded.n, mad = excluded.mad, samples = excluded.samples, updated_ms = excluded.updated_ms",
        { $k: key, $v: st.ema.value, $n: st.ema.n, $m: st.ema.mad, $s: st.samples ? JSON.stringify(st.samples) : null, $u: at },
      ),
    );
  };

  /** EMA of actual / RAW estimate on input tokens (all classes), only for clean calls [CONS-24, PT-09]. */
  const calibrate = (r: UsageRecord): void => {
    if (r.outcome !== "ok" || (r.continuations ?? 0) > 0 || !r.promptId || !r.estimate) return;
    const raw = r.estimate.raw ?? r.estimate;
    const actual = r.usage.in + r.usage.cacheWrite + r.usage.cacheRead;
    if (!(raw.in > 0) || !(actual > 0)) return;
    const key = callKey({ engine: r.engine, promptId: r.promptId, model: r.model });
    const prev = calibration().get(key)?.ema ?? null;
    saveCal(key, { ema: emaUpdate(prev, actual / raw.in, CALIBRATION.callClamp) });
  };

  const checkMismatch = (r: UsageRecord): void => {
    const rep = r.usage.reportedUsd;
    if (rep === undefined || rep <= 0) return;
    const diff = Math.abs(r.usage.apiUsd - rep) / rep;
    if (diff > MISMATCH) log.warn("agent.usage.price_mismatch", { model: r.model, apiUsd: r.usage.apiUsd, reportedUsd: rep, diffPct: Math.round(diff * 100) });
  };

  const totalsAdd = (t: UsageTotals, row: Row): void => {
    t.calls++;
    t.in += row.in_tok;
    t.cacheWrite += row.cache_write;
    t.cacheRead += row.cache_read;
    t.out += row.out_tok;
    t.apiUsd = Math.round((t.apiUsd + row.api_usd) * 1e6) / 1e6;
  };

  const rowOf = (r: UsageRecord): Row => ({
    at_ms: Date.parse(r.at),
    engine: r.engine,
    model: r.model,
    in_tok: r.usage.in,
    cache_write: r.usage.cacheWrite,
    cache_read: r.usage.cacheRead,
    out_tok: r.usage.out,
    api_usd: r.usage.apiUsd,
  });

  return {
    record(input: Omit<UsageRecord, "id">): UsageRecord {
      const rec: UsageRecord = { id: newId("usage", deps.random), ...input };
      pending.add(rec);
      checkMismatch(rec);
      calibrate(rec);
      if (rec.window) lastWindow = rec.window;
      const row = rowOf(rec);
      write(
        "use.record",
        () => {
          deps.db.run(
            "INSERT INTO use_ledger (id, at_ms, ws, engine, model, prompt_id, outcome, in_tok, cache_write, cache_read, out_tok, api_usd, record) VALUES ($id, $at, $ws, $e, $m, $p, $o, $i, $cw, $cr, $out, $usd, $rec)",
            {
              $id: rec.id,
              $at: row.at_ms,
              $ws: rec.ws,
              $e: rec.engine,
              $m: rec.model,
              $p: rec.promptId ?? null,
              $o: rec.outcome,
              $i: row.in_tok,
              $cw: row.cache_write,
              $cr: row.cache_read,
              $out: row.out_tok,
              $usd: row.api_usd,
              $rec: JSON.stringify(rec),
            },
          );
          if (rec.window)
            deps.db.run("INSERT INTO use_windows (at_ms, source, window) VALUES ($a, $s, $w)", {
              $a: row.at_ms,
              $s: rec.window.source,
              $w: JSON.stringify(rec.window),
            });
        },
        () => pending.delete(rec),
      );
      return rec;
    },

    summary(range: UsageRange, ws?: WorkspaceKey): UsageSummary {
      const now = deps.clock.now();
      const days = range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 0;
      const from = days === 0 ? 0 : localMidnight(now) - (days - 1) * DAY_MS;
      const where = ws === undefined ? "at_ms >= $from" : "at_ms >= $from AND ws = $ws";
      const params = ws === undefined ? { $from: from } : { $from: from, $ws: ws };
      const rows = deps.db.all<Row & { id: string }>(
        `SELECT id, at_ms, engine, model, in_tok, cache_write, cache_read, out_tok, api_usd FROM use_ledger WHERE ${where}`,
        params,
      );
      const seen = new Set(rows.map((r) => r.id));
      for (const r of pending) if (!seen.has(r.id) && Date.parse(r.at) >= from && (ws === undefined || r.ws === ws)) rows.push({ id: r.id, ...rowOf(r) });
      const totals = emptyTotals();
      const byDay = new Map<string, UsageTotals>();
      const byEngine: Partial<Record<EngineId, UsageTotals>> = {};
      const byModel: Record<string, UsageTotals> = {};
      for (const row of rows) {
        totalsAdd(totals, row);
        const d = dayOf(row.at_ms);
        if (!byDay.has(d)) byDay.set(d, emptyTotals());
        totalsAdd(byDay.get(d) as UsageTotals, row);
        const e = row.engine as EngineId;
        byEngine[e] ??= emptyTotals();
        totalsAdd(byEngine[e] as UsageTotals, row);
        byModel[row.model] ??= emptyTotals();
        totalsAdd(byModel[row.model] as UsageTotals, row);
      }
      const accurate = [...calibration().entries()].filter(([k, s]) => k.startsWith("call:") && s.ema.n >= CALIBRATION.minN).map(([, s]) => s.ema.mad * 100);
      const out: UsageSummary = {
        range,
        totals,
        byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, t]) => ({ day, totals: t })),
        byEngine,
        byModel,
        estimateAccuracyPct: accurate.length === 0 ? 25 : Math.round(accurate.reduce((a, b) => a + b, 0) / accurate.length),
      };
      const w =
        lastWindow ??
        (() => {
          const r = deps.db.get<{ window: string }>("SELECT window FROM use_windows ORDER BY at_ms DESC LIMIT 1");
          return r ? (JSON.parse(r.window) as SubscriptionWindow) : null;
        })();
      if (w) out.window = w;
      return out;
    },

    factor(key: { engine: EngineId; promptId: string; model: ModelId }): { factor: number; n: number; accuracyPct: number } {
      const st = calibration().get(callKey(key));
      if (!st || st.ema.n < CALIBRATION.minN) return { factor: 1, n: st?.ema.n ?? 0, accuracyPct: 25 };
      return { factor: st.ema.value, n: st.ema.n, accuracyPct: Math.round(st.ema.mad * 100) };
    },

    fixedOverhead(profileKey: Xxh3): { tokens: number; n: number } | null {
      const st = calibration().get(overheadKey(profileKey));
      return st ? { tokens: Math.round(st.ema.value), n: st.ema.n } : null;
    },

    windowFactor(): { kappa: number | null; n: number } {
      const st = calibration().get("window.5h");
      const n = st?.ema.n ?? 0;
      return { kappa: n >= KAPPA.minN && st?.samples?.length ? median(st.samples) : null, n };
    },

    recordWindowSample(s: { utilizationBefore: number; utilizationAfter: number; apiUsd: number; resetsAtUnchanged: boolean }): void {
      const kappa = (s.utilizationAfter - s.utilizationBefore) / s.apiUsd;
      if (!(s.apiUsd >= KAPPA.minUsd) || !s.resetsAtUnchanged || !Number.isFinite(kappa) || kappa < 0 || kappa > 1) {
        log.debug("agent.ledger.kappa_rejected", { apiUsd: s.apiUsd, resetsAtUnchanged: s.resetsAtUnchanged });
        return;
      }
      const prev = calibration().get("window.5h");
      const samples = [...(prev?.samples ?? []), kappa].slice(-KAPPA.keep);
      saveCal("window.5h", { ema: { value: median(samples), n: (prev?.ema.n ?? 0) + 1, mad: 0 }, samples });
    },

    recordOverhead(profileKey: Xxh3, tokens: number): void {
      if (!(tokens > 0) || !Number.isFinite(tokens)) return;
      const key = overheadKey(profileKey);
      saveCal(key, { ema: emaUpdate(calibration().get(key)?.ema ?? null, tokens, OVERHEAD_CLAMP) });
    },

    async flush(): Promise<void> {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
  };
}
