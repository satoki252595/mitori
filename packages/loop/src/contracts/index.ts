/**
 * @mitori/loop — `contracts/` (owner: WP-08a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { AnchorEngine } from "@mitori/anchor";
import type {
  AnswerOutput,
  BlockId,
  BlockKind,
  CheckError,
  DocPatchOutput,
  ErrorCode,
  FindingsOutput,
  Hasher,
  LineNo,
  RepoPath,
  Result,
  ThreadId,
} from "@mitori/core";
import type { ApplyEditsInput, ApplyEditsResult, ParsedAgent, ParsedPatch } from "../contract.ts";
import { parseAnswer, parseFindings } from "./answer.ts";
import { applyEdits } from "./apply.ts";
import { Checks } from "./check.ts";
import { parseDocpatch } from "./docpatch.ts";
import { parseAgent, parsePatch } from "./patch.ts";

/** Pure text-level patch application (the repository layer writes the files; spec §5.2 steps 1–6): all or nothing, every problem reported. */
export function applyEditsToText(input: ApplyEditsInput, anchors: Pick<AnchorEngine, "lineMap">, hasher: Hasher): ApplyEditsResult {
  return applyEdits(input, anchors, hasher);
}

type Raw = { structured?: unknown; text?: string };
type Failure = { code: ErrorCode; errors: CheckError[] };

/** Parse + validate an engine output against a contract (structured JSON, or the answer text protocol). Never trusts the engine; ≤ 20 CheckErrors. */
export function parseContract(
  contract: "patch/1",
  raw: Raw,
  ctx: { taskThreads: ThreadId[]; docBlocks: BlockId[]; blockKinds: Record<BlockId, BlockKind>; write: RepoPath[]; primaryBlock: BlockId | null },
): Result<ParsedPatch, Failure>;
export function parseContract(
  contract: "agent/1",
  raw: Raw,
  ctx: { taskThreads: ThreadId[]; docBlocks: BlockId[]; blockKinds: Record<BlockId, BlockKind>; primaryBlock: BlockId | null },
): Result<ParsedAgent, Failure>;
export function parseContract(
  contract: "answer/1",
  raw: Raw,
  ctx: { citeExists(path: RepoPath, start: LineNo, end: LineNo): boolean },
): Result<AnswerOutput & { cites: { path: RepoPath; start: LineNo; end: LineNo; exists: boolean }[] }, Failure>;
export function parseContract(
  contract: "findings/1",
  raw: Raw,
  ctx: { citeExists(path: RepoPath, start: LineNo, end: LineNo): boolean },
): Result<FindingsOutput, Failure>;
export function parseContract(
  contract: "docpatch/1",
  raw: Raw,
  ctx: { docBlocks: BlockId[]; blockKinds: Record<BlockId, BlockKind> },
): Result<DocPatchOutput, Failure>;
export function parseContract(contract: string, raw: Raw, ctx: unknown): Result<unknown, Failure> {
  switch (contract) {
    case "patch/1":
      return parsePatch(raw, ctx as Parameters<typeof parsePatch>[1]);
    case "agent/1":
      return parseAgent(raw, ctx as Parameters<typeof parseAgent>[1]);
    case "answer/1":
      return parseAnswer(raw, ctx as Parameters<typeof parseAnswer>[1]);
    case "findings/1":
      return parseFindings(raw, ctx as Parameters<typeof parseFindings>[1]);
    case "docpatch/1":
      return parseDocpatch(raw, ctx as Parameters<typeof parseDocpatch>[1]);
    default: {
      const checks = new Checks();
      checks.add("", "patch/1 | agent/1 | answer/1 | findings/1 | docpatch/1", contract, "E_INVALID_INPUT");
      return { ok: false, error: checks.failure() };
    }
  }
}
