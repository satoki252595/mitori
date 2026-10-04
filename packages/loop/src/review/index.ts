/**
 * @mitori/loop — `review/` (owner: WP-07). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files. The `ReviewEngine` factory lives in `./engine.ts`
 * (composed by `createLoop`, WP-08b).
 */
import type { Anchor, BlockId, Decision, DiagramId, Message, Migration, RepoPath, SectionId, Thread, ThreadDetail } from "@mitori/core";
import { type BatchJobPlan, type DisplayState, REVIEW_STDOUT } from "../contract.ts";
import { planPartitions } from "./plan.ts";
import { LOOP_SCHEMA_V1, LOOP_SCHEMA_V2, LOOP_SCHEMA_V3 } from "./schema.ts";
import { bodyLines, bundleLabel, firstLine, labelText, lf, quoteLines } from "./text.ts";

// CR-PENDING(ux) cr-requests/ux.md #1: the Fix code targets (`POST /ws/:ws/jobs/targets`, CR ux-F1) are not a
// `ReviewEngine` method in the loop contract yet; the server route calls the pure resolver directly.
export { resolveCodeTargets, TARGET_LIMITS, type TargetDeps, type TargetInput } from "./targets.ts";

/** `anchorHealth === "outdated"` (and not resolved/draft) ⇒ "outdated", else the stored state. */
export function displayState(t: Pick<Thread, "state" | "anchorHealth">): DisplayState {
  return t.anchorHealth === "outdated" && t.state !== "resolved" && t.state !== "draft" ? "outdated" : t.state;
}

/** Deterministic Finish(push) partition (spec §2.4.3). Same input ⇒ same plan. */
export function planBatch(
  threads: ThreadDetail[],
  ctx: { moduleOf(path: RepoPath): string; writeScopeOf(t: ThreadDetail): RepoPath[]; anchoredLinesOf(t: ThreadDetail): number },
): BatchJobPlan[] {
  return planPartitions(threads, ctx);
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
  const out = [`# DC: ${d.title.replace(/\s+/g, " ").trim()}`, "", `- id: ${d.id}`, `- status: ${d.status}`, `- decided: ${d.decidedAt.slice(0, 10)}`];
  if (d.thread) out.push(`- thread: ${d.thread} (local)`);
  for (const l of input.docLinks) out.push(`- doc: [${l.label}](${l.href})`);
  for (const l of input.codeLinks) out.push(`- code: [${l.label}](${l.href})`);
  out.push("", "## Context", "", lf(input.context).replace(/\n+$/, ""), "", "## Decision", "", lf(input.decision).replace(/\n+$/, ""), "", "## Discussion", "");
  for (const m of input.discussion) out.push(`- R${m.round} ${m.by}: ${firstLine(m.body, 120)}`);
  if (input.discussion.length === 0) out.pop();
  return `${out.join("\n")}\n`;
}

/** The doc_edit ASK text (spec §2.6.3): fixed Japanese header + old/new block lines prefixed with "> ". */
export function renderDocEditAsk(oldMd: string, newMd: string): string {
  return ["設計書をこの版に合わせてコードを変更してください。", "--- 現在の設計書", ...quoteLines(oldMd), "+++ 新しい設計書", ...quoteLines(newMd)].join("\n");
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
  const n = String(input.round);
  if (input.approved) {
    return `${[REVIEW_STDOUT.header.replace("{n}", n).replace("{k}", "0").replace("{approved}", "true"), REVIEW_STDOUT.approved, REVIEW_STDOUT.nextNone].join("\n")}\n`;
  }
  const out = [
    REVIEW_STDOUT.header.replace("{n}", n).replace("{k}", String(input.threads.length)).replace("{approved}", "false"),
    REVIEW_STDOUT.instructions,
    "",
  ];
  for (const t of input.threads) {
    const th = t.thread;
    // CR-PENDING(WP-07): the entry type has no bundle size; callers pass `bundleTokens` as an extra property.
    const tokens = (t as { bundleTokens?: number }).bundleTokens;
    let heading = REVIEW_STDOUT.threadHeading
      .replace("{id}", th.id)
      .replace("{intent}", th.intent)
      .replace("{n}", n)
      .replace("{carried}", t.carriedFrom === undefined ? "" : ` carried=R${t.carriedFrom}`)
      .replace("{outdated}", displayState(th) === "outdated" ? " outdated" : "")
      .replace("{anchor}", t.anchorLabel);
    if (tokens !== undefined) heading += ` ${bundleLabel(tokens)}`;
    if (th.intent === "note") heading += " (memo: do not edit code)";
    out.push(heading);
    t.humanMessages.forEach((m, i) => {
      if (i > 0) out.push(">");
      out.push(...bodyLines(m.body));
    });
  }
  out.push("", REVIEW_STDOUT.next.replace("{n}", String(input.round + 1)));
  return `${out.join("\n")}\n`;
}

/** Anchor label used in `mitori.review/1`, MCP list lines and Inbox (spec §10.1). */
export function anchorLabel(
  anchor: Anchor,
  ctx: { sectionOf(block: BlockId): SectionId | null; diagramNodeLabel(dg: DiagramId, node: string): string | null },
): string {
  if (anchor.primary === "code" && anchor.code) return `${anchor.code.path}:${anchor.code.start}-${anchor.code.end}`;
  if (anchor.primary === "diagram" && anchor.diagram) {
    const dg = anchor.diagram;
    if (dg.node !== undefined)
      return `diagram:${dg.diagram}/${labelText(ctx.diagramNodeLabel(dg.diagram, dg.node) ?? dg.node, REVIEW_STDOUT.diagramLabelChars)}`;
    return dg.edge !== undefined ? `diagram:${dg.diagram}/${dg.edge}` : `diagram:${dg.diagram}`;
  }
  if (anchor.doc) {
    const section = ctx.sectionOf(anchor.doc.block);
    const where = section === null ? anchor.doc.block : `§${section}`;
    const q = anchor.doc.quote?.exact;
    if (q) return `${where} "${labelText(q, REVIEW_STDOUT.quoteLabelChars)}"`;
    return section === null ? where : `${where} ${anchor.doc.block}`;
  }
  if (anchor.code) return `${anchor.code.path}:${anchor.code.start}-${anchor.code.end}`;
  return anchor.diagram ? `diagram:${anchor.diagram.diagram}` : "?";
}

/**
 * Migrations owned by `@mitori/loop` (`rev_*`, `job_*`; DDL in spec §2.8). Version 1 = the whole §2.8 schema
 * (WP-07 writes it; later versions are appended here by the S6 stream).
 */
export const LOOP_MIGRATIONS: readonly Migration[] = [
  { pkg: "@mitori/loop", db: "workspace", version: 1, up: LOOP_SCHEMA_V1 },
  { pkg: "@mitori/loop", db: "workspace", version: 2, up: LOOP_SCHEMA_V2 },
  { pkg: "@mitori/loop", db: "workspace", version: 3, up: LOOP_SCHEMA_V3 },
];
