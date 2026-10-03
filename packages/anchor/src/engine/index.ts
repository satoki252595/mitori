/**
 * @mitori/anchor — `engine/` (owner: WP-07). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Hasher, unsupported } from "@mitori/core";
import type { AnchorEngine } from "../contract.ts";

/** Factory (pure; core-only dependency). */
export function createAnchorEngine(deps: { hasher: Hasher }): AnchorEngine {
  return unsupported("anchor.createAnchorEngine", deps);
}
