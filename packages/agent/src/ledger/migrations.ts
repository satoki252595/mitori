import type { Migration } from "@mitori/core";

/**
 * `use_*` tables in `~/.mitori/state.sqlite` (ARCHITECTURE §5): append-only ledger (one row per engine turn; the full
 * `UsageRecord` is kept as JSON next to the aggregated columns), observed windows, calibration (`CalibrationKey` → EMA).
 */
export const LEDGER_MIGRATIONS: readonly Migration[] = [
  {
    pkg: "@mitori/agent",
    db: "state",
    version: 1,
    up: `
CREATE TABLE use_ledger (
  id TEXT PRIMARY KEY,
  at_ms INTEGER NOT NULL,
  ws TEXT,
  engine TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_id TEXT,
  outcome TEXT NOT NULL,
  in_tok INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  out_tok INTEGER NOT NULL,
  api_usd REAL NOT NULL,
  record TEXT NOT NULL
) STRICT;
CREATE INDEX use_ledger_at ON use_ledger(at_ms);
CREATE TABLE use_windows (
  at_ms INTEGER NOT NULL,
  source TEXT NOT NULL,
  window TEXT NOT NULL
) STRICT;
CREATE INDEX use_windows_at ON use_windows(at_ms);
CREATE TABLE use_calibration (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL,
  n INTEGER NOT NULL,
  mad REAL NOT NULL,
  samples TEXT,
  updated_ms INTEGER NOT NULL
) STRICT;
`,
  },
];
