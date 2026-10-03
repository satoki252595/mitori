/**
 * @mitori/agent — `bridge/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import {
  type Clock,
  type EffectiveSettings,
  type EngineId,
  type EventSink,
  type Hasher,
  type Logger,
  type Metrics,
  type Migration,
  type Random,
  type SseEventPayload,
  unsupported,
  type WriteQueue,
} from "@mitori/core";
import type { AgentScheduler, Engine, Spawner, UsageLedger } from "../contract.ts";

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
  return unsupported("agent.createAgentBridge", deps);
}

/** Migrations of the usage ledger + calibration (`use_*` in `state.sqlite`). */
export const AGENT_MIGRATIONS: readonly Migration[] = [];
