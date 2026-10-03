/**
 * @mitori/testkit — `server/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import type { Engine, Spawner } from "@mitori/agent";
import { type Clock, type EngineId, unsupported } from "@mitori/core";
import type { FixtureName, RandomSource, TestDaemon, TestServer } from "../contract.ts";

export function startTestServer(opts?: {
  spawner?: Spawner;
  engines?: Partial<Record<EngineId, Engine>>;
  clock?: Clock;
  random?: RandomSource;
}): Promise<TestServer> {
  return unsupported("testkit.startTestServer", opts);
}

export function startTestDaemon(opts: {
  fixture?: FixtureName;
  repoPath?: string;
  /** Pre-seed `.mitori/` from `fixtures/golden/<fixture>/doc-generated/`. */
  seedDoc?: "none" | "static" | "generated";
  cassetteDirs?: readonly string[];
  scenario?: Readonly<Record<string, string>>;
  speed?: number;
  maxDtMs?: number;
  binary?: "source" | "compiled";
  env?: Readonly<Record<string, string>>;
}): Promise<TestDaemon> {
  return unsupported("testkit.startTestDaemon", opts);
}
