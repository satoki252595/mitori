/**
 * @mitori/agent — `bridge/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type {
  BinaryPin,
  Clock,
  EffectiveSettings,
  EngineId,
  EventSink,
  FsReader,
  Hasher,
  Logger,
  Metrics,
  Migration,
  Random,
  SafeWriter,
  SseEventPayload,
  WriteQueue,
} from "@mitori/core";
import type { FetchLike } from "../adapters/anthropic-engine.ts";
import type { AgentScheduler, Engine, Spawner, UsageLedger } from "../contract.ts";
import type { FollowPorts } from "../follow.ts";
import { LEDGER_MIGRATIONS } from "../ledger/migrations.ts";
import { assembleBridge } from "./assemble.ts";

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
  /**
   * System prompt files `run/sp/*` (kind `home`, I3) and the empty sandbox `run/empty` (I9) [CR m1-57]. Optional
   * until every caller passes it: without it claude-cli and generic runs fail with `E_PRECONDITION`.
   */
  safeWrite?: SafeWriter;
  /** Byte-compare before reuse (SEC-20), the sandbox listing, first-run binary resolution [CR m1-57, m1-65]. */
  fs?: FsReader;
  /** HTTP for anthropic-api (defaults to the global `fetch`). */
  fetch?: FetchLike;
  /**
   * Persist a first-run pin (TOFU) through the settings service [CR m1-65]. Absent ⇒ the bridge still resolves and
   * pins `claude` on SAFE_PATH for this daemon's lifetime, so the engine card is usable on a fresh install.
   */
  pin?: (engine: EngineId, pin: BinaryPin) => Promise<void>;
  /**
   * Vendor-update auto-follow (WP28): POSIX ownership + file identity for the re-check, one streamed hash,
   * and workspace roots for the SEC-10 path check. Absent ⇒ changed binaries keep reporting
   * `E_ENGINE_BINARY_CHANGED` / gone-binary (spec §B).
   */
  follow?: FollowPorts;
  /** Persist a followed Muse binary into `engines.generic.argv[0]` (daemon-internal; web PATCH stays closed). */
  saveGenericBinary?: (path: string) => Promise<void>;
}): { scheduler: AgentScheduler; engines: Record<EngineId, Engine | null> } {
  return assembleBridge(deps);
}

/** Migrations of the usage ledger + calibration (`use_*` in `state.sqlite`). */
export const AGENT_MIGRATIONS: readonly Migration[] = LEDGER_MIGRATIONS;
