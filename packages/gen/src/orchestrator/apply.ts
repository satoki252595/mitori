/**
 * Doc application of validated lines (gen spec §3.6-3, §6.5, §6.7): each block line is stamped by the
 * Verifier OUTSIDE the write queue, then applied with `doc.applyGenerated` INSIDE it, one line at a time, in
 * order (streaming: the block is committed before the reply ends). Locked blocks and trigger `incremental`
 * become proposals (the doc store decides per block); deletes are deferred to the end of the task so the
 * mass-delete guard sees the whole reply (≥ 4 listed and > 50 % deleted ⇒ the excess becomes proposals).
 * Patch-form prompts answer for existing blocks: `doc.sync` lines are always proposals (`source.kind: "sync"`, D12;
 * `autoAcceptDocUpdates` writes them), `doc.simplify` lines are proposals that inherit the block's claims (§12).
 * An update whose text is unchanged is not a content change: its re-stamped claims (cites, checks, verdict) are
 * recorded directly, so a regeneration or sync that confirms a sentence clears its staleness.
 */
import {
  type BlockAspect,
  type BlockId,
  type Claim,
  type ClaimId,
  type DocLang,
  type EngineId,
  type GenRunId,
  type GenStage,
  type Logger,
  type ModelId,
  type PromptVersion,
  toErrorData,
  type WriteQueue,
  type Xxh3,
} from "@mitori/core";
import type { ApplyOptions, ClaimSpan, DocStore, GeneratedBlock, GeneratedClaim, NewBlockRef } from "@mitori/doc";
import { GEN_LIMITS, GEN_PROMPTS, type GenBlockLine, type GenLine, type GenPromptId, type GenQuestionLine, type GenTermLine } from "../contract.ts";
import { deriveSpans, plainText } from "../line/mdscan.ts";
import { computeVerdict } from "../verify/index.ts";
import type { GenVerifier } from "../verify/verifier.ts";

/** Who / what produced the lines (server-stamped provenance). */
export interface ApplyContext {
  /** Run. */
  run: GenRunId;
  /** Trigger of the run. */
  trigger: "user" | "incremental" | "ondemand";
  /** Engine. */
  engine: EngineId;
  /** Model requested. */
  model: ModelId;
  /** Model that answered when different. */
  servedBy?: string;
  /** Stage. */
  stage: GenStage;
  /** Prompt version. */
  promptVer: PromptVersion;
  /** Snapshot the input was built from (stamping + provenance). */
  indexDigest: Xxh3;
  /** The run's pinned repo-pack snapshot (cites of locations shown only in the pack, PT-05). */
  packSnapshot?: Xxh3;
  /** Doc language. */
  lang: DocLang;
  /** Number of EXISTING blocks listed. */
  listed: number;
  /** `review.autoAcceptDocUpdates`. */
  autoAccept: boolean;
  /** Replay from cache: skip locked / vanished targets instead of proposing. */
  replay?: boolean;
  /** Prompt of the task (patch-form prompts answer for existing blocks). */
  prompt?: GenPromptId;
}

/** What the executor needs from a line sink (doc blocks via {@link ApplySink}, translations via `TranslationSink`). */
export interface LineSink {
  /** `new:n` → block id across attempts and replays. */
  readonly idMap: Record<NewBlockRef, BlockId>;
  /** Blocks written or updated. */
  readonly written: BlockId[];
  /** Blocks created by this sink. */
  readonly created: BlockId[];
  /** Accepted lines in order (normalized NDJSON, stored in gen_outputs). */
  readonly lines: string[];
  /** Term lines seen. */
  readonly terms: GenTermLine[];
  /** Question lines seen (RAW of gen.questions; the s13 list for gen.questions itself). */
  readonly questions: GenQuestionLine[];
  /** Verifier outcomes (task metrics). */
  readonly checks: { l0Raw: number; l1Pass: number; l1Fail: number; l1Vacuous: number; repaired: number };
  /** Queue one validated line. */
  accept(line: GenLine): void;
  /** Wait for queued lines (and apply deferred work). */
  finish(): Promise<void>;
}

/** Ports. */
export interface ApplyDeps {
  /** Doc store. */
  doc: DocStore;
  /** Write queue. */
  write: WriteQueue;
  /** Verifier. */
  verifier: GenVerifier;
  /** Logger. */
  log: Logger;
}

/** Ordered per-task applier. */
export class ApplySink implements LineSink {
  /** `new:n` → block id across attempts and replays. */
  readonly idMap: Record<NewBlockRef, BlockId>;
  /** Blocks written or updated. */
  readonly written: BlockId[] = [];
  /** Blocks this sink created (`new:n` lines), for removing a paused attempt's partial output. */
  readonly created: BlockId[] = [];
  /** Proposals created. */
  readonly proposals: string[] = [];
  /** Accepted lines in order (normalized NDJSON, stored in gen_outputs). */
  readonly lines: string[] = [];
  /** Term lines seen. */
  readonly terms: GenTermLine[] = [];
  /** Question lines seen. */
  readonly questions: GenQuestionLine[] = [];
  /** Claims written. */
  claims = 0;
  /** Verifier outcomes of the stamped claims (task metrics, §14): raw L0 pass, L1 tri-state, W04/W08 repairs. */
  readonly checks = { l0Raw: 0, l1Pass: 0, l1Fail: 0, l1Vacuous: 0, repaired: 0 };
  /** Lines that failed to apply (doc store errors). */
  failures = 0;
  private readonly deletes: BlockId[] = [];
  private flowOrder = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: ApplyDeps,
    private readonly ctx: ApplyContext,
    idMap: Record<NewBlockRef, BlockId> = {},
    private readonly onWritten?: (ids: readonly BlockId[]) => void,
  ) {
    this.idMap = { ...idMap };
  }

  /** Queue one validated line (applied in arrival order). */
  accept(line: GenLine): void {
    this.lines.push(JSON.stringify(line));
    this.chain = this.chain.then(() =>
      this.applyOne(line).catch((err: unknown) => {
        this.failures++;
        this.deps.log.warn("gen.apply.failed", { run: this.ctx.run, line: line.t, code: toErrorData(err).code });
      }),
    );
  }

  /** Wait for queued lines, then apply deferred deletes. */
  async finish(): Promise<void> {
    await this.chain;
    if (this.deletes.length === 0) return;
    const { listed } = this.ctx;
    const guard = listed >= GEN_LIMITS.massDeleteMinListed;
    const allowed = guard ? Math.floor(listed * GEN_LIMITS.massDeleteShare) : this.deletes.length;
    const direct = this.deletes.slice(0, allowed);
    const excess = this.deletes.slice(allowed);
    if (direct.length > 0) await this.apply([], direct, this.mode());
    if (excess.length > 0) await this.apply([], excess, "propose");
  }

  private mode(): ApplyOptions["mode"] {
    if (this.ctx.prompt === "doc.simplify") return "propose";
    if (this.ctx.prompt === "doc.sync" || this.ctx.trigger === "incremental") return this.ctx.autoAccept ? "write" : "propose";
    return "write";
  }

  private get patch(): boolean {
    return this.ctx.prompt !== undefined && GEN_PROMPTS[this.ctx.prompt].form === "patch";
  }

  private async apply(blocks: GeneratedBlock[], deletes: BlockId[], mode: ApplyOptions["mode"]) {
    const kind = this.ctx.prompt === "doc.sync" ? "sync" : this.ctx.prompt === "doc.simplify" ? "simplify" : "regen";
    const reason =
      kind === "sync"
        ? `updated for the changed code by ${this.ctx.promptVer}`
        : kind === "simplify"
          ? `newcomer rewrite by ${this.ctx.promptVer}`
          : `regenerated by ${this.ctx.promptVer}`;
    const opts: ApplyOptions = { mode, deletes, source: { kind, id: this.ctx.run }, reason, listed: this.ctx.listed };
    const res = await this.deps.write("gen.apply", () => {
      const r = this.deps.doc.applyGenerated(blocks, opts);
      // an update with the same text still re-verified its claims (new cites / checks): record them (no content change).
      // Same text ⇒ same canonical markers, so claim n is the block's n-th claim.
      const same = new Set(r.unchanged);
      const refresh = blocks.flatMap((b) => {
        if (b.id === null || !same.has(b.id)) return [];
        const old = this.deps.doc.claims(b.id);
        return b.claims.flatMap((c) => {
          const o = old[c.n - 1];
          return o ? [{ id: o.id, checks: c.checks, cites: c.cites, verdict: c.verdict }] : [];
        });
      });
      if (refresh.length > 0) this.deps.doc.setClaimChecks(refresh);
      return r;
    });
    Object.assign(this.idMap, res.idMap);
    this.created.push(...Object.values(res.idMap));
    this.written.push(...res.written);
    this.proposals.push(...res.proposals);
    if (res.written.length > 0) this.onWritten?.(res.written);
    return res;
  }

  private async applyOne(line: GenLine): Promise<void> {
    switch (line.t) {
      case "block": {
        const gb = await this.generated(line);
        if (!gb) return;
        await this.apply([gb], [], this.mode());
        this.claims += gb.claims.length;
        return;
      }
      case "delete":
        if (this.deps.doc.block(line.id)) this.deletes.push(line.id);
        return;
      case "module": {
        const label = line.summary === undefined ? { module: line.module, name: line.name } : { module: line.module, name: line.name, summary: line.summary };
        await this.deps.write("gen.labels", () => this.deps.doc.setModuleLabels([label]));
        return;
      }
      case "flow": {
        const order = this.flowOrder++;
        await this.deps.write("gen.flow", () => this.deps.doc.upsertFlowSection(line.key, line.title, order));
        return;
      }
      case "term":
        this.terms.push(line);
        return;
      case "question":
        this.questions.push(line);
        return;
      default:
        return;
    }
  }

  private count(c: GeneratedClaim["checks"]): void {
    if (c.l0Raw ?? c.l0) this.checks.l0Raw++;
    if (c.l1 === "pass") this.checks.l1Pass++;
    else if (c.l1 === "fail") this.checks.l1Fail++;
    else this.checks.l1Vacuous++;
    if (c.repaired && c.repaired.length > 0) this.checks.repaired++;
  }

  /** Stamp a block line into a GeneratedBlock (null ⇒ skip: replay onto a locked / vanished block). */
  private async generated(line: GenBlockLine): Promise<GeneratedBlock | null> {
    const doc = this.deps.doc;
    let id: BlockId | null = null;
    let ref: NewBlockRef | undefined;
    if (line.id.startsWith("new:")) {
      ref = line.id as NewBlockRef;
      const mapped = this.idMap[ref];
      if (mapped && doc.block(mapped)) id = mapped;
    } else id = line.id as BlockId;
    const current = id ? doc.block(id) : null;
    if (id && !current) {
      if (this.ctx.replay && ref) id = null;
      else if (this.ctx.replay) return null;
    }
    if (this.ctx.replay && current?.lock) return null;
    // a patch line answers for an existing block (validator V04): without it there is nothing to update
    if (this.patch && !current) return null;
    const spans = new Map<number, ClaimSpan>(deriveSpans(line.md).map((s) => [s.n, s]));
    const old = id ? doc.claims(id) : [];
    const used = new Set<ClaimId>();
    const claims: GeneratedClaim[] = [];
    // doc.simplify keeps the claims of the block (same ids, cites and checks); only the quotes are re-derived (§12)
    if (this.ctx.prompt === "doc.simplify")
      old.forEach((c, i) => {
        const quote = spans.get(i + 1)?.quote ?? c.quote;
        claims.push({ n: i + 1, kind: c.kind, quote, cites: c.cites, checks: c.checks, verdict: c.verdict, reuse: c.id });
      });
    for (const c of this.ctx.prompt === "doc.simplify" ? [] : Array.isArray(line.claims) ? line.claims : []) {
      const span = spans.get(c.n) ?? { n: c.n, start: 0, end: 0, quote: "", identifiers: [] };
      const st = await this.deps.verifier.stamp(c.cites, span, this.ctx.indexDigest, this.ctx.packSnapshot);
      this.count(st.checks);
      const verdictInput = { checks: st.checks, cites: st.cites.length, anyStale: false, ...(current?.lock ? { lock: current.lock } : {}) };
      const gc: GeneratedClaim = { n: c.n, kind: c.kind, quote: span.quote, cites: st.cites, checks: st.checks, verdict: computeVerdict(verdictInput) };
      const reuse = matchClaim(old, used, span.quote, st.cites);
      if (reuse) gc.reuse = reuse;
      claims.push(gc);
    }
    let after: BlockId | NewBlockRef | null | undefined;
    if (line.after !== undefined) after = line.after.startsWith("new:") ? (this.idMap[line.after as NewBlockRef] ?? line.after) : line.after;
    const keepShape = this.patch && current !== null;
    const gb: GeneratedBlock = {
      id,
      section: keepShape ? current.section : (line.section ?? (current?.section as NonNullable<GenBlockLine["section"]>)),
      kind: keepShape ? current.kind : (line.kind ?? current?.kind ?? "prose"),
      depth: keepShape ? current.depth : (line.depth ?? current?.depth ?? "L2"),
      audience: keepShape ? current.audience : (line.audience ?? current?.audience ?? ["dev"]),
      lang: this.ctx.lang,
      md: line.md,
      claims,
      gen: {
        model: this.ctx.model,
        engine: this.ctx.engine,
        stage: this.ctx.stage,
        promptVer: this.ctx.promptVer,
        indexDigest: this.ctx.indexDigest,
        run: this.ctx.run,
        ...(this.ctx.servedBy ? { servedBy: this.ctx.servedBy } : {}),
      },
    };
    if (ref && id === null) gb.ref = ref;
    const aspect: BlockAspect | undefined = keepShape ? current.aspect : (line.aspect ?? current?.aspect);
    if (aspect) gb.aspect = aspect;
    if (after !== undefined) gb.after = after;
    if (line.diagram) gb.diagram = { ...line.diagram, origin: "ai" };
    return gb;
  }
}

/**
 * A cached output can be replayed only onto a doc that still has every EXISTING block it refers to (update /
 * keep / delete / after by id). The cache key leaves the target's current content out (R6), so an output made
 * while regenerating would otherwise replay as nothing onto a doc that lost those blocks (e.g. a fresh doc
 * over an old workspace DB). Such an output is treated as a miss.
 */
export function replayable(lines: readonly string[], doc: Pick<DocStore, "block">): boolean {
  for (const l of lines) {
    const line = JSON.parse(l) as GenLine;
    const ids: string[] = [];
    if (line.t === "keep" || line.t === "delete") ids.push(line.id);
    else if (line.t === "block") {
      if (!line.id.startsWith("new:")) ids.push(line.id);
      if (line.after !== undefined && !line.after.startsWith("new:")) ids.push(line.after);
    }
    if (ids.some((id) => !doc.block(id as BlockId))) return false;
  }
  return true;
}

/** §6.7-6 claim identity: the first unused old claim with the same normalized quote, else the same cite set. */
function matchClaim(
  old: readonly Claim[],
  used: Set<ClaimId>,
  quote: string,
  cites: readonly { path: string; start: number; end: number }[],
): ClaimId | undefined {
  // whitespace-insensitive: the doc store's quotes drop the space at CJK↔ASCII boundaries (UXP-24), span quotes keep it
  const norm = (q: string) => plainText(q).replace(/\s+/g, "").toLowerCase();
  const key = (cs: readonly { path: string; start: number; end: number }[]) =>
    cs
      .map((c) => `${c.path}:${c.start}-${c.end}`)
      .sort()
      .join(",");
  const free = old.filter((c) => !used.has(c.id));
  const hit = free.find((c) => quote !== "" && norm(c.quote) === norm(quote)) ?? free.find((c) => cites.length > 0 && key(c.cites) === key(cites));
  if (hit) used.add(hit.id);
  return hit?.id;
}
