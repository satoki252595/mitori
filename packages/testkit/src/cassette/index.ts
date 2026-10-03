/**
 * @mitori/testkit — `cassette/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import type { Engine, EngineRequest, Spawner, SpawnSpec, StreamNormalizer, UsageLedger } from "@mitori/agent";
import { type Clock, type EngineId, type UsageRecord, unsupported, unsupportedValue, type Xxh3 } from "@mitori/core";
import type { GenLine } from "@mitori/gen";
import type { Cassette, CassetteMode, CassetteStore, FakeEngine, KeyContext, RecordingScheduler, SynthFailure, SynthOptions } from "../contract.ts";

/** Normalization applied to system and prompt text before hashing (specs/testing.md §3.3, byte-exact rules). */
export function normalizeForKey(text: string, ctx: KeyContext): string {
  return unsupported("testkit.normalizeForKey", text, ctx);
}

/** Key from an engine request. MUST equal {@link cassetteKeyFromSpawn} of the SpawnSpec built for the same request. */
export function cassetteKey(
  req: Pick<EngineRequest, "model" | "effort" | "tools" | "jsonSchema" | "resume" | "system" | "prompt">,
  engine: EngineId,
  ctx: KeyContext,
): Xxh3 {
  return unsupported("testkit.cassetteKey", req, engine, ctx);
}

/** Key from a claude-cli SpawnSpec (argv flags + `--system-prompt-file` content + stdin). */
export function cassetteKeyFromSpawn(spec: SpawnSpec, readFile: (path: string) => string, ctx: KeyContext): Xxh3 {
  return unsupported("testkit.cassetteKeyFromSpawn", spec, readFile, ctx);
}

export function openCassettes(opts: { dirs: readonly string[]; mode?: CassetteMode; maxUsd?: number }): CassetteStore {
  return unsupported("testkit.openCassettes", opts);
}

/** Spawner that serves claude-cli processes from cassettes; non-engine argv (git, gates) go to `fallback`. */
export function createReplaySpawner(
  store: CassetteStore,
  opts: {
    /** Key context. */
    keyContext: KeyContext;
    /** Read a file (system prompt file). */
    readFile: (path: string) => string;
    /** 0 = no delays (default), 1 = recorded timing, n = recorded/n. */
    speed?: number;
    /** Cap per-line delay (default 200 ms). */
    maxDtMs?: number;
    /** Scenario router: return a cassette name to bypass exact matching. */
    scenario?: (spec: SpawnSpec) => string | null;
    /** Real spawner for allowed binaries (`git`, gate argv in int tests). */
    fallback?: Spawner;
  },
): Spawner {
  return unsupported("testkit.createReplaySpawner", store, opts);
}

/** Spawner that runs the real engine and records (record/auto). Stops spawning once `maxUsd` is reached. */
export function createTeeSpawner(
  real: Spawner,
  store: CassetteStore,
  opts: { keyContext: KeyContext; readFile: (path: string) => string; maxUsd: number },
): Spawner {
  return unsupported("testkit.createTeeSpawner", real, store, opts);
}

/** Synthesizer of claude stream-json cassettes. */
export const synth: {
  /** Plain answer text. */
  text(text: string, o?: SynthOptions): Cassette;
  /** `gen.block/1` output; strings are emitted verbatim (malformed-line tests). */
  genLines(lines: readonly (GenLine | string)[], o?: SynthOptions): Cassette;
  /** A failure mode. */
  failure(kind: SynthFailure, o?: SynthOptions): Cassette;
} = unsupportedValue<{
  /** Plain answer text. */
  text(text: string, o?: SynthOptions): Cassette;
  /** `gen.block/1` output; strings are emitted verbatim (malformed-line tests). */
  genLines(lines: readonly (GenLine | string)[], o?: SynthOptions): Cassette;
  /** A failure mode. */
  failure(kind: SynthFailure, o?: SynthOptions): Cassette;
}>("testkit.synth");

export function createFakeEngine(opts: { id?: EngineId; normalizer: StreamNormalizer; store?: CassetteStore; speed?: number; clock?: Clock }): FakeEngine {
  return unsupported("testkit.createFakeEngine", opts);
}

export function createImmediateScheduler(engines: Partial<Record<EngineId, Engine>>): RecordingScheduler {
  return unsupported("testkit.createImmediateScheduler", engines);
}

/** In-memory ledger. */
export function memLedger(): UsageLedger & { readonly rows: readonly UsageRecord[] } {
  return unsupported("testkit.memLedger");
}
