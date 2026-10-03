/**
 * @mitori/testkit — `golden/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files (compare.ts).
 */
import { compareGolden } from "./compare.ts";

/**
 * Compare with `fixtures/golden/<rel>`; objects are written as canonical JSON (sorted keys, 2 spaces, LF, trailing LF).
 * With `MITORI_UPDATE_GOLDEN=1` the file is (re)written and the assertion passes.
 */
export function expectGolden(rel: string, actual: string | object, opts?: { normalize?: (text: string) => string }): void {
  compareGolden(rel, actual, opts);
}
