/**
 * @mitori/loop — `review/` (owner: WP-07). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import {
  type Anchor,
  type BlockId,
  type Decision,
  type DiagramId,
  type Message,
  type Migration,
  type RepoPath,
  type SectionId,
  type Thread,
  type ThreadDetail,
  unsupported,
} from "@mitori/core";
import type { BatchJobPlan, DisplayState } from "../contract.ts";

/** `anchorHealth === "outdated"` (and not resolved/draft) ⇒ "outdated", else the stored state. */
export function displayState(t: Pick<Thread, "state" | "anchorHealth">): DisplayState {
  return unsupported("loop.displayState", t);
}

/** Deterministic Finish(push) partition (spec §2.4.3). Same input ⇒ same plan. */
export function planBatch(
  threads: ThreadDetail[],
  ctx: { moduleOf(path: RepoPath): string; writeScopeOf(t: ThreadDetail): RepoPath[]; anchoredLinesOf(t: ThreadDetail): number },
): BatchJobPlan[] {
  return unsupported("loop.planBatch", threads, ctx);
}

/** Decision record Markdown (deterministic; spec §2.6.1). Written by the doc store (`DocStore.writeDecision`, cross-spec). */
export function renderDecisionMarkdown(
  d: Decision,
  input: {
    context: string;
    decision: string;
    discussion: Pick<Message, "by" | "round" | "body">[];
    docLinks: { label: string; href: string }[];
    codeLinks: { label: string; href: string }[];
  },
): string {
  return unsupported("loop.renderDecisionMarkdown", d, input);
}

/** The doc_edit ASK text (spec §2.6.3): fixed Japanese header + old/new block lines prefixed with "> ". */
export function renderDocEditAsk(oldMd: string, newMd: string): string {
  return unsupported("loop.renderDocEditAsk", oldMd, newMd);
}

/** `mitori.review/1` stdout renderer (≤ 50 tokens overhead per thread; bodies verbatim, `> `-prefixed). */
export function renderReviewStdout(input: {
  /** Round number. */
  round: number;
  /** Threads in the round (human messages since their previous dispatch are rendered). */
  threads: { thread: ThreadDetail; carriedFrom?: number; humanMessages: Message[]; anchorLabel: string }[];
  /** Approved (zero pending at Finish). */
  approved: boolean;
}): string {
  return unsupported("loop.renderReviewStdout", input);
}

/** Anchor label used in `mitori.review/1`, MCP list lines and Inbox (spec §10.1). */
export function anchorLabel(
  anchor: Anchor,
  ctx: { sectionOf(block: BlockId): SectionId | null; diagramNodeLabel(dg: DiagramId, node: string): string | null },
): string {
  return unsupported("loop.anchorLabel", anchor, ctx);
}

/**
 * Migrations owned by `@mitori/loop` (`rev_*`, `job_*`; DDL in spec §2.8). Version 1 = the whole §2.8 schema
 * (WP-07 writes it; later versions are appended here by the S6 stream).
 */
export const LOOP_MIGRATIONS: readonly Migration[] = [];
