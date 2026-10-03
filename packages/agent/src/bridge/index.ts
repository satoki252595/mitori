/**
 * @mitori/agent — `bridge/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Clock, EffectiveSettings, EngineId, EventSink, Hasher, Logger, Metrics, Migration, Random, SseEventPayload, WriteQueue } from "@mitori/core";
import type { AgentScheduler, Engine, Spawner, UsageLedger } from "../contract.ts";
import { LEDGER_MIGRATIONS } from "../ledger/migrations.ts";
import { assembleBridge, type BridgeExtraDeps } from "./assemble.ts";

/** Factory for the scheduler + engines. */
export function createAgentBridge(deps: {
  /** Daemon-wide writer of `state.sqlite` (ledger, calibration) [CONS-03]. */
  stateWrite: WriteQueue;
  /** Random (session ids) [CR test-1]. */
  random: Random;
  /** Metrics (`agent.*`). */
  metrics: Metrics;
  /**
   * SAFE_PATH env [SEC-10]: PATH with empty/relative entries, entries under any workspace root, `node_modules/.bin`
   * and `.venv/bin` removed; the daemon chdir'ed to `~/.mitori/run/empty`; claude/git/gh resolved once and pinned.
   */
  safePath: string;
  /** Settings (global). */
  settings: () => EffectiveSettings["global"];
  /** Spawner. */
  spawner: Spawner;
  /** Ledger. */
  ledger: UsageLedger;
  /** Logger. */
  log: Logger;
  /** Clock. */
  clock: Clock;
  /** Hasher (system prompt file names, warm profile keys). */
  hasher: Hasher;
  /** Events (`scheduler.updated`, `usage.updated`, `engines.updated`). */
  events: EventSink<SseEventPayload>;
  /** Absolute `~/.mitori` path (system-prompt files, empty sandbox dir). */
  home: string;
  /** Parent environment (scrubbed per request). */
  env: Readonly<Record<string, string | undefined>>;
}): { scheduler: AgentScheduler; engines: Record<EngineId, Engine | null> } {
  // CR-PENDING(WP-05): SafeWriter/FsReader (cr-requests/WP-05.md #2) and `fetch` arrive as optional extra deps.
  return assembleBridge(deps as typeof deps & Partial<BridgeExtraDeps>);
}

/** Migrations of the usage ledger + calibration (`use_*` in `state.sqlite`). */
export const AGENT_MIGRATIONS: readonly Migration[] = LEDGER_MIGRATIONS;
