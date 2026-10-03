/**
 * Ask answer → doc (gen spec §12 「文書に追記」, loop spec §2.6.2): no LLM. The answer's Markdown becomes an insert
 * proposal right after the thread's block (`kind` faq for a question, deepdive otherwise; `source.kind:
 * "answer_promote"`), and every inline cite `[[path:a-b]]` becomes a claim stamped by the Verifier at the current
 * snapshot (L0–L2), so the proposal card shows verdicts and accepting it keeps the cites as claims.
 * CR-PENDING(WP-06b): `GenOrchestrator` has no entry point for it yet (cr-requests/WP-06b.md R3); loop's `promote`
 * proposes the raw link-converted Markdown without claims until the server routes it here.
 */
import { type BlockId, type EngineId, MitoriError, type ModelId, type ProposalId, type ThreadId } from "@mitori/core";
import type { GeneratedBlock, GeneratedClaim, RawCite } from "@mitori/doc";
import { deriveSpans, normalizeMarkers } from "../line/mdscan.ts";
import type { Services } from "../orchestrator/runner.ts";
import { computeVerdict } from "../verify/index.ts";

/** Inline cite token of an answer (loop `ANSWER_CITE_RE`): `[[path:start-end]]` or `[[path:line]]`. */
const ANSWER_CITE_RE = /\[\[([^[\]\s]+?):(\d+)(?:-(\d+))?\]\]/gu;

/** One answer to promote. */
export interface AnswerPromotion {
  /** Thread whose answer it is (proposal source id). */
  thread: ThreadId;
  /** Answer Markdown with `[[path:a-b]]` cites. */
  md: string;
  /** Block the thread is anchored on (the proposal inserts after it). */
  after: BlockId;
  /** `faq` (question intent) or `deepdive`. */
  kind: "faq" | "deepdive";
  /** Model / engine that wrote the answer (provenance). */
  model?: ModelId;
  /** Engine. */
  engine?: EngineId;
  /** One-line reason for the card (thread title). */
  title?: string;
}

/** Create the insert proposal; returns its id. */
export async function promoteAnswer(svc: Services, input: AnswerPromotion): Promise<ProposalId> {
  const deps = svc.deps;
  const anchor = deps.doc.block(input.after);
  if (!anchor) throw new MitoriError("E_NOT_FOUND", `block ${input.after} not found`, { params: { block: input.after } });
  const raws: RawCite[][] = [];
  const withMarkers = input.md.trim().replace(ANSWER_CITE_RE, (_m, path: string, a: string, b: string | undefined) => {
    raws.push([{ path, start: Number(a), end: Number(b ?? a) }]);
    return `[[${raws.length}]]`;
  });
  const md = normalizeMarkers(withMarkers).md;
  const spans = new Map(deriveSpans(md).map((s) => [s.n, s]));
  const claims: GeneratedClaim[] = [];
  for (const [i, cites] of raws.entries()) {
    const n = i + 1;
    const span = spans.get(n) ?? { n, start: 0, end: 0, quote: "", identifiers: [] };
    const st = await svc.verifier.stamp(cites, span);
    claims.push({
      n,
      kind: "fact",
      quote: span.quote,
      cites: st.cites,
      checks: st.checks,
      verdict: computeVerdict({ checks: st.checks, cites: st.cites.length, anyStale: false }),
    });
  }
  const s = deps.settings();
  const gb: GeneratedBlock = {
    id: null,
    section: anchor.section,
    after: anchor.id,
    kind: input.kind,
    depth: input.kind === "faq" ? "L2" : "L3",
    audience: input.kind === "faq" ? ["newcomer", "dev"] : ["reviewer", "dev"],
    lang: svc.lang(),
    md,
    claims,
    gen: {
      model: input.model ?? s.global.models.answer,
      engine: input.engine ?? "claude-cli",
      stage: "S8",
      promptVer: "answer_promote@1",
      indexDigest: deps.indexer.snapshot()?.indexDigest ?? "",
    },
  };
  const res = await deps.write("gen.answer", () =>
    deps.doc.applyGenerated([gb], {
      mode: "propose",
      deletes: [],
      source: { kind: "answer_promote", id: input.thread },
      reason: `${input.kind}: ${input.title ?? input.thread}`,
      listed: 0,
    }),
  );
  const id = res.proposals[0];
  if (id === undefined) throw new MitoriError("E_INTERNAL", "the answer proposal was not created", { params: { thread: input.thread } });
  return id as ProposalId;
}
