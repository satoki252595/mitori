/**
 * @mitori/loop — `contracts/` (owner: WP-08a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import type { AnchorEngine } from "@mitori/anchor";
import {
  type AnswerOutput,
  type BlockId,
  type BlockKind,
  type CheckError,
  type ErrorCode,
  type FindingsOutput,
  type Hasher,
  type LineNo,
  type RepoPath,
  type Result,
  type ThreadId,
  unsupported,
} from "@mitori/core";
import type { ApplyEditsInput, ApplyEditsResult, ParsedAgent, ParsedPatch } from "../contract.ts";

/** Parse + validate an engine output against a contract (structured JSON, or the answer text protocol). */
export function parseContract(
  contract: "patch/1",
  raw: { structured?: unknown; text?: string },
  ctx: { taskThreads: ThreadId[]; docBlocks: BlockId[]; blockKinds: Record<BlockId, BlockKind>; write: RepoPath[]; primaryBlock: BlockId | null },
): Result<ParsedPatch, { code: ErrorCode; errors: CheckError[] }>;
export function parseContract(
  contract: "agent/1",
  raw: { structured?: unknown; text?: string },
  ctx: { taskThreads: ThreadId[]; docBlocks: BlockId[]; blockKinds: Record<BlockId, BlockKind>; primaryBlock: BlockId | null },
): Result<ParsedAgent, { code: ErrorCode; errors: CheckError[] }>;
export function parseContract(
  contract: "answer/1",
  raw: { structured?: unknown; text?: string },
  ctx: { citeExists(path: RepoPath, start: LineNo, end: LineNo): boolean },
): Result<AnswerOutput & { cites: { path: RepoPath; start: LineNo; end: LineNo; exists: boolean }[] }, { code: ErrorCode; errors: CheckError[] }>;
export function parseContract(
  contract: "findings/1",
  raw: { structured?: unknown; text?: string },
  ctx: { citeExists(path: RepoPath, start: LineNo, end: LineNo): boolean },
): Result<FindingsOutput, { code: ErrorCode; errors: CheckError[] }>;
export function parseContract(...args: unknown[]): never {
  return unsupported("loop.parseContract", ...args);
}

/** Pure text-level patch application (the git layer writes the files; spec §5.2 steps 1–6). */
export function applyEditsToText(input: ApplyEditsInput, anchors: Pick<AnchorEngine, "lineMap">, hasher: Hasher): ApplyEditsResult {
  return unsupported("loop.applyEditsToText", input, anchors, hasher);
}
