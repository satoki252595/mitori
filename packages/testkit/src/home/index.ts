/**
 * @mitori/testkit — `home/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files (home.ts, random.ts, sink.ts).
 */
import type { CollectingSink, RandomSource, TestHome } from "../contract.ts";
import { createHome } from "./home.ts";
import { seeded } from "./random.ts";
import { collecting } from "./sink.ts";

export type { TestHome } from "../contract.ts";

/** Isolated `MITORI_HOME` (0700) + the env to spawn mitori / git with (see `testEnv`). Removed by `cleanup()`. */
export function createTestHome(opts?: { keep?: boolean }): Promise<TestHome> {
  return createHome(opts);
}

/** Same seed ⇒ same bytes. Satisfies core's `Random` port. */
export function seededRandom(seed: string | number): RandomSource {
  return seeded(seed);
}

export function collectingSink<E>(): CollectingSink<E> {
  return collecting<E>();
}
