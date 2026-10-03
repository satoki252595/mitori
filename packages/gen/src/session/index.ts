/**
 * @mitori/gen — `session/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type GenTaskId, type Hasher, type PrepId, type Sha256, unsupported, type WorkspaceKey, type Xxh3 } from "@mitori/core";

/** fingerprint = sha256(salt ‖ canonicalJson({format, prep, phase, ws, indexDigest, tasks: [[id, cacheKey]…sorted]})). */
export function prepFingerprint(
  input: {
    /** Workspace salt (gen_meta). */
    salt: string;
    /** Packet. */
    prep: PrepId;
    /** Phase. */
    phase: number;
    /** Workspace. */
    ws: WorkspaceKey;
    /** Index digest. */
    indexDigest: Xxh3;
    /** Task ids with cache keys. */
    tasks: readonly (readonly [GenTaskId, Xxh3])[];
  },
  hasher: Hasher,
): Sha256 {
  return unsupported("gen.prepFingerprint", input, hasher);
}
