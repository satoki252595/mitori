import { type BlockId, type CopyPromptReq, type CopyPromptRes, MitoriError, type ThreadDetail, type ThreadId } from "@mitori/core";
import { deriveScope } from "../router/scope.ts";
import { type BundleInputExt, build } from "./build.ts";
import type { BundleBuilderDeps } from "./deps.ts";

/** Id of the thread that does not exist yet (Composer text copied before anything is saved). */
const NO_THREAD = "th_00000000" as ThreadId;
const COPY_OUT_TOKENS = 1500;

/**
 * Copy-as-prompt (works with no engine, no thread, no job): the same MBF/1 `copy` bundle built for a synthetic
 * thread made of the anchor and the ask. There is no thread to reply to, so the DO block is the generic one whatever
 * the target; change-like intents get a WRITE scope from the router's derivation, the rest `WRITE -`.
 */
export async function copyPrompt(deps: BundleBuilderDeps, req: CopyPromptReq): Promise<CopyPromptRes> {
  const s = deps.settings();
  const now = deps.clock?.iso() ?? "1970-01-01T00:00:00.000Z";
  const thread: ThreadDetail = {
    id: NO_THREAD,
    anchor: req.anchor,
    anchorHealth: "ok",
    stale: false,
    intent: req.intent,
    state: "draft",
    round: 1,
    version: 1,
    title: req.ask.slice(0, 60),
    jobs: [],
    createdAt: now,
    updatedAt: now,
    messages: [{ id: "m_0000000000", thread: NO_THREAD, by: "human", kind: "comment", body: req.ask, round: 1, createdAt: now, html: "" }],
    jobViews: [],
  };
  const writes = req.intent === "change" || req.intent === "doc_edit";
  const claimCites = (claim: string) => (req.anchor.doc ? (deps.doc.claims(req.anchor.doc.block).find((c) => c.id === claim)?.cites ?? []) : []);
  const scope = deriveScope([thread], {
    mode: writes ? "patch" : "answer",
    extra: [],
    deny: s.denyGlobs,
    citesOfBlock: (b: BlockId) => deps.doc.claims(b).flatMap((c) => c.cites),
    citesOfClaim: claimCites,
    moduleFilesOfSection: (section) => {
      const module = deps.doc.section(section)?.node.module;
      return module ? (deps.indexer.module(module)?.paths ?? []) : [];
    },
    fileExists: (p) => deps.indexer.file(p) !== null,
    fileEntry: (p) => deps.indexer.file(p),
    sectionOfBlock: (b) => deps.doc.block(b)?.section ?? null,
  });
  if (!scope.ok) throw MitoriError.from(scope.error);

  const input: BundleInputExt = {
    threads: [thread],
    mode: "copy",
    extra: [],
    removed: [],
    write: scope.value.writeScope,
    deny: s.denyGlobs,
    gates: [],
    out: "reply",
    budget: { in: s.global.limits.bundleDefaultTokens, out: COPY_OUT_TOKENS, usd: 0 },
    target: "generic",
  };
  const bundle = await build(deps, input, s.global.limits.bundleDefaultTokens);
  return { text: bundle.text, tokens: bundle.tokens };
}
