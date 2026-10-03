/**
 * @mitori/testkit — `server/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files (daemon.ts, test-flag.ts).
 * `startTestServer` is still an M0 stub (E_UNSUPPORTED) until the composition root (WP-INT) exists: implement it in place
 * and keep the signature (contract changes go through the CR batch, packages/core/CR-LEDGER.md).
 */
import type { Engine, Spawner } from "@mitori/agent";
import { type Clock, type EngineId, unsupported } from "@mitori/core";
import type { FixtureName, RandomSource, TestDaemon, TestServer } from "../contract.ts";
import { startDaemon } from "./daemon.ts";

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
  return startDaemon(opts);
}
