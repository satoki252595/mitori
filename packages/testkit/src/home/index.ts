/**
 * @mitori/testkit — `home/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { CollectingSink, RandomSource, TestHome } from "../contract.ts";

export function createTestHome(opts?: { keep?: boolean }): Promise<TestHome> {
  return unsupported("testkit.createTestHome", opts);
}

export function seededRandom(seed: string | number): RandomSource {
  return unsupported("testkit.seededRandom", seed);
}

export function collectingSink<E>(): CollectingSink<E> {
  return unsupported("testkit.collectingSink");
}
