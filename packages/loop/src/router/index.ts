/**
 * @mitori/loop — `router/` (owner: WP-08a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import {
  type BlockId,
  type Cite,
  type ClaimId,
  type EffectiveSettings,
  type ExecMode,
  type FileEntry,
  type Glob,
  type LineNo,
  type RepoPath,
  type Result,
  type SectionId,
  type ThreadDetail,
  unsupported,
} from "@mitori/core";
import type { RouteInput, RouteOutcome } from "../contract.ts";

/** Pure router. Errors: E_INVALID_INPUT (R0/R8/override), E_PRECONDITION (R7, scope), E_DENY_GLOB, E_UNSUPPORTED, E_AGENT_CAPABILITY. */
export function route(input: RouteInput, settings: EffectiveSettings): Result<RouteOutcome> {
  return unsupported("loop.route", input, settings);
}

/** Write-scope derivation (spec §3.3). Deterministic; never decided by a model. */
export function deriveWriteScope(
  threads: ThreadDetail[],
  ctx: {
    mode: ExecMode;
    extra: { path: RepoPath; start: LineNo; end: LineNo }[];
    deny: Glob[];
    citesOfBlock(block: BlockId): Cite[];
    citesOfClaim(claim: ClaimId): Cite[];
    moduleFilesOfSection(section: SectionId): RepoPath[];
    fileExists(path: RepoPath): boolean;
    fileEntry(path: RepoPath): FileEntry | null;
  },
): Result<{ writeScope: RepoPath[]; newFiles: RepoPath[]; anchoredLines: number; ranges: { path: RepoPath; start: LineNo; end: LineNo }[] }> {
  return unsupported("loop.deriveWriteScope", threads, ctx);
}
