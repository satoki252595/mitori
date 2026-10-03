/**
 * CR m1-112: ONE sqlite opener — `@mitori/platform` `openSqlDb` (WAL, busy timeout, strict named parameters).
 * CR-PENDING(WP-11) cr-requests/WP-11.md #6: kept for `build/selftest.ts` (WP-11a); delete once it imports platform.
 */
import type { SqlDb } from "@mitori/core";
import { openSqlDb } from "@mitori/platform";

export function openSqlite(path: string): SqlDb {
  return openSqlDb(path);
}
