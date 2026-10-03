/**
 * @mitori/platform — `hash/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Hasher } from "@mitori/core";
import { gitBlobOid, sha256Hex, xxh3Hex } from "./digest.ts";

/** The production {@link Hasher} (Bun: native xxHash3 / sha1 / sha256). Stateless; one instance is enough. */
export function createHasher(): Hasher {
  return { xxh3: xxh3Hex, sha256: sha256Hex, gitBlob: gitBlobOid };
}
