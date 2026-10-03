/**
 * @mitori/gen — `session/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { canonicalJson, FORMAT, type GenTaskId, type Hasher, type PrepId, type Sha256, type WorkspaceKey, type Xxh3 } from "@mitori/core";

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
  const tasks = [...input.tasks]
    .map(([id, key]) => [id, key])
    .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : (a[0] as string) > (b[0] as string) ? 1 : 0));
  const body = canonicalJson({ format: FORMAT.prep, prep: input.prep, phase: input.phase, ws: input.ws, indexDigest: input.indexDigest, tasks });
  return hasher.sha256(`${input.salt}${body}`);
}
