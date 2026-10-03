/**
 * @mitori/platform — `clock/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Clock } from "@mitori/core";

/** Wall clock (production). Tests inject `createFakeClock()` from `@mitori/platform/testing`. */
export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

export { realTimers, type TimerId, type Timers } from "./timers.ts";
