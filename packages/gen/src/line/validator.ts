/**
 * Stateful per-attempt validator of `gen.block/1` lines (gen spec §6.1–§6.3, §6.7-7). Each line is checked on
 * arrival; a valid line comes back normalized (compact form expanded to full form, W-repairs applied, unknown
 * keys dropped, claims as {@link GenClaimDraft}[] with the RAW cites — the Verifier repairs/stamps them).
 * State (new refs, accounted ids, flows, module lines, accepted aspects) changes only for valid lines.
 */
import type { Audience, BlockAspect, BlockId, BlockKind, CheckError, Depth, DocLang, ModuleId, SectionId, StopReason } from "@mitori/core";
import { ASPECT_DEFAULTS, type RawCite, SECTION_ASPECTS } from "@mitori/doc";
import {
  type CoverageReport,
  type ExistingRef,
  GEN_LIMITS,
  type GenBlockLine,
  type GenClaimDraft,
  type GenLine,
  type GenLineType,
  type GenRuleId,
  type LineValidator,
  type LineVerdict,
  type NewBlockRef,
  type ValidationContext,
} from "../contract.ts";
import { BLOCK_ASPECTS, kindsOf } from "./aspects.ts";
import { isObject, parseCiteObject, parseClaims, short } from "./claims.ts";
import { validateDiagram } from "./diagram.ts";
import { headingProblem, inlineProblems, isGfmTable, mdLength } from "./mdrules.ts";
import { codeRanges, markersInCode, normalizeMarkers, placeMarkers, scanMarkers, stripMarkers, tightenFullWidth } from "./mdscan.ts";

/** A cite that cannot be accepted as written. */
interface CiteProblem {
  rule: "V17" | "V18";
  expected: string;
  actual: string;
}

const LINE_TYPES: ReadonlySet<string> = new Set<GenLineType>(["block", "keep", "delete", "module", "flow", "term", "question", "verdict", "end"]);
const KNOWN_KEYS: Readonly<Record<GenLineType, readonly string[]>> = {
  block: ["t", "id", "section", "aspect", "kind", "depth", "audience", "md", "claims", "diagram", "after"],
  keep: ["t", "id"],
  delete: ["t", "id"],
  module: ["t", "module", "name", "summary"],
  flow: ["t", "key", "title"],
  term: ["t", "term", "yomi", "en", "def"],
  question: ["t", "section", "text", "cites", "from"],
  verdict: ["t", "claim", "v"],
  end: ["t", "blocks"],
};
const LINE_KINDS: ReadonlySet<string> = new Set<BlockKind>(["prose", "list", "table", "diagram", "learn", "recap", "pitfall", "deepdive", "why", "faq"]);
const DEPTHS: readonly Depth[] = ["L0", "L1", "L2", "L3"];
const AUDIENCES: ReadonlySet<string> = new Set<Audience>(["newcomer", "dev", "reviewer", "pm", "sre"]);
const BLOCK_ID_RE = /^b_[0-9a-hjkmnp-tv-z]{8}$/;
const NEW_REF_RE = /^new:[1-9][0-9]{0,2}$/;
const MODULE_RE = /^md_[0-9a-hjkmnp-tv-z]{8}$/;
const FLOW_KEY_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SECTION_RE = /^(?:s1[0-3]|s[0-9]|appendix)(?:\/[a-z0-9][a-z0-9-]{0,39})?$/;
const YOMI_RE = /^[ぁ-ゖー]{1,40}$/;
const CLAIM_ID_RE = /^cl_[0-9a-hjkmnp-tv-z]{8}$/;
const RAW_Q_RE = /^q[0-9]{1,3}$/;
const FENCE_LINE_RE = /^(?:`{3,}|~{3,})[A-Za-z0-9_-]*$/;
const FLOW_ASPECTS: readonly BlockAspect[] = SECTION_ASPECTS["s3/*"];
const MAX_ERRORS_PER_LINE = 5;

/** Errors / warnings of one line. */
class LineCheck {
  readonly errors: CheckError[] = [];
  readonly warnings: GenRuleId[] = [];
  constructor(readonly line: number) {}
  err(rule: GenRuleId, at: string, expected: string, actual: unknown): void {
    if (this.errors.length >= MAX_ERRORS_PER_LINE) return;
    this.errors.push({ at: `L${this.line}${at}`, expected: `${rule} ${expected}`, actual: short(actual), code: "E_GEN_OUTPUT_INVALID" });
  }
  warn(rule: GenRuleId): void {
    if (!this.warnings.includes(rule)) this.warnings.push(rule);
  }
  get ok(): boolean {
    return this.errors.length === 0;
  }
}

/** UTF-8 byte length without allocating. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Code point count. */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function sentenceCount(text: string): number {
  return text.split(/[。．！？]|[.!?](?=\s|$)/).filter((s) => s.trim() !== "").length;
}

/** Validator for one task attempt. */
export class GenLineValidator implements LineValidator {
  private readonly newRefs = new Set<string>();
  private readonly accounted = new Set<BlockId>();
  private readonly flowKeys: string[] = [];
  private readonly moduleLines = new Set<ModuleId>();
  private readonly accepted: { section: SectionId; aspect: BlockAspect | undefined }[] = [];
  private readonly flowsEnabled: boolean;
  private endSeen = false;
  /** Block lines received (valid or not) — the end line's self-reported count is compared with it (W05). */
  private blockLines = 0;

  constructor(private readonly ctx: ValidationContext) {
    this.flowsEnabled = ctx.lineTypes.includes("flow");
  }

  validate(raw: string, lineNo: number): LineVerdict {
    const c = new LineCheck(lineNo);
    const verdict = (value?: GenLine | null): LineVerdict =>
      value && c.ok ? { line: lineNo, value, errors: [], warnings: c.warnings } : { line: lineNo, errors: c.errors, warnings: c.warnings };
    const bytes = utf8Length(raw);
    if (bytes > GEN_LIMITS.lineMaxBytes) {
      c.err("V30", "", `line ≤ ${GEN_LIMITS.lineMaxBytes} bytes`, `${bytes} bytes`);
      return verdict();
    }
    const s = raw.replace(/\r/g, "").replace(/^﻿/, "").trim();
    if (s === "") return verdict();
    if (FENCE_LINE_RE.test(s)) {
      c.warn("W01");
      return verdict();
    }
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      c.err("V01", "", "exactly one JSON object per line", s);
      return verdict();
    }
    if (!isObject(obj)) {
      c.err("V01", "", "a JSON object", s);
      return verdict();
    }
    const t = obj.t;
    if (typeof t !== "string" || !LINE_TYPES.has(t) || !this.ctx.lineTypes.includes(t as GenLineType)) {
      c.err("V02", "/t", `line type one of ${this.ctx.lineTypes.join(", ")}`, t);
      return verdict();
    }
    const type = t as GenLineType;
    if ((type === "keep" || type === "delete") && this.ctx.existing.size === 0) {
      c.err("V02", "/t", "keep/delete only when the task lists EXISTING blocks", t);
      return verdict();
    }
    const known = KNOWN_KEYS[type];
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (known.includes(k)) o[k] = v;
      else c.warn("W02");
    }
    switch (type) {
      case "block":
        this.blockLines++;
        return verdict(this.block(o, c));
      case "keep":
      case "delete":
        return verdict(this.keepDelete(type, o, c));
      case "module":
        return verdict(this.module(o, c));
      case "flow":
        return verdict(this.flow(o, c));
      case "term":
        return verdict(this.term(o, c));
      case "question":
        return verdict(this.question(o, c));
      case "verdict":
        return verdict(this.verdictLine(o, c));
      case "end":
        return verdict(this.end(o, c));
    }
  }

  finish(stop: StopReason): CoverageReport {
    const ctx = this.ctx;
    const has = (section: SectionId | null, aspect: BlockAspect) =>
      this.accepted.some((a) => a.aspect === aspect && (section === null || a.section === section));
    const missing: BlockAspect[] = [];
    const flowGaps: { key: string; aspect: BlockAspect }[] = [];
    if (this.flowsEnabled) {
      for (const a of ctx.requiredAspects) {
        if (!FLOW_ASPECTS.includes(a)) {
          if (!has(null, a)) missing.push(a);
          continue;
        }
        const lacking = this.flowKeys.filter((k) => !has(`s3/${k}`, a));
        if (lacking.length > 0) missing.push(a);
        for (const key of lacking) flowGaps.push({ key, aspect: a });
      }
    } else for (const a of ctx.requiredAspects) if (!has(null, a)) missing.push(a);
    const moduleLineMissing = ctx.moduleLineRequired && this.moduleLines.size === 0;
    const truncated = (stop === "budget" || stop === "max_turns") && !this.endSeen;
    return {
      missingAspects: missing,
      ...(flowGaps.length > 0 ? { flowGaps } : {}),
      unaccounted: [...ctx.existing.keys()].filter((id) => !this.accounted.has(id)),
      moduleLineMissing,
      flows: this.flowKeys.length,
      blocks: this.accepted.length,
      truncated,
      ok: missing.length === 0 && !moduleLineMissing && this.flowKeys.length >= ctx.flows.min && !truncated,
    };
  }

  private block(o: Record<string, unknown>, c: LineCheck): GenBlockLine | null {
    const ctx = this.ctx;
    const patch = ctx.form === "patch";
    const id = o.id;
    let ref: NewBlockRef | null = null;
    let existing: ExistingRef | undefined;
    if (typeof id === "string" && NEW_REF_RE.test(id) && !patch) {
      if (this.newRefs.has(id)) c.err("V03", "/id", "each new:<n> used once", id);
      else ref = id as NewBlockRef;
    } else if (typeof id === "string" && BLOCK_ID_RE.test(id)) {
      existing = ctx.existing.get(id as BlockId);
      if (!existing) c.err("V04", "/id", "an id listed in EXISTING", id);
      else if (this.accounted.has(id as BlockId)) c.err("V26", "/id", "each EXISTING id accounted once", id);
    } else c.err("V03", "/id", patch ? "an existing block id" : `"new:<n>" or an existing block id`, id);

    const md = o.md;
    const mdOk = typeof md === "string" && md.length >= 1 && md.length <= 8000;
    if (!mdOk) c.err("V03", "/md", "md string of 1..8000 chars", md);

    let aspect: BlockAspect | undefined = existing?.aspect;
    let section: SectionId | null = ctx.primarySection;
    let kind: BlockKind | undefined = existing?.kind;
    let depth: Depth | undefined;
    let audience: Audience[] | undefined;
    if (!patch) {
      aspect = this.aspect(o.aspect, c);
      section = this.section(o.section, aspect, c);
      if (section && aspect && !ctx.aspectsOf(section).includes(aspect))
        c.err("V06", "/aspect", `one of ${ctx.aspectsOf(section).join(", ") || "(none)"}`, aspect);
      if (aspect) {
        kind = this.kind(o.kind, aspect, c);
        depth = this.depth(o.depth, aspect, c);
        audience = this.audience(o.audience, aspect, c);
      }
    }

    let diagram: GenBlockLine["diagram"];
    if (kind === "diagram" && o.diagram === undefined) c.err("V21", "/diagram", "a diagram object for kind diagram", "missing");
    if (kind !== undefined && kind !== "diagram" && o.diagram !== undefined) c.err("V21", "/diagram", "no diagram unless kind is diagram", kind);
    if (kind === "diagram" && o.diagram !== undefined) {
      const flows = ctx.prompt === "gen.flows";
      const r = validateDiagram(o.diagram, {
        nodes: flows ? GEN_LIMITS.flowDiagramNodes : GEN_LIMITS.diagramNodes,
        edges: flows ? GEN_LIMITS.flowDiagramEdges : GEN_LIMITS.diagramEdges,
        modules: ctx.modules,
      });
      for (const p of r.problems) c.err("V20", p.at, p.expected, p.actual);
      if (r.diagram) diagram = r.diagram;
    }

    let mdNorm = typeof md === "string" ? md : "";
    if (mdOk) {
      const limit = this.mdLimit(kind, aspect);
      const len = mdLength(mdNorm);
      if (len > limit) c.err("V10", "/md", `md ≤ ${limit} chars for kind ${kind ?? "?"}`, `${len} chars`);
      const ranges = codeRanges(mdNorm);
      for (const p of inlineProblems(mdNorm, ranges))
        c.err(p.rule, "/md", p.rule === "V11" ? "no raw HTML" : "no links, images, autolinks or ID comments", p.found);
      const h = headingProblem(mdNorm);
      if (h) c.err("V12", "/md", "no headings", h.found);
      if (kind === "table" && !isGfmTable(mdNorm)) c.err("V27", "/md", "a GFM table (header row + delimiter row)", mdNorm.split("\n")[0]);
      const norm = normalizeMarkers(mdNorm);
      if (norm.moved) c.warn("W07");
      mdNorm = norm.md;
      if (ctx.lang === "ja") {
        const tight = tightenFullWidth(mdNorm);
        if (tight.changed) c.warn("W12");
        mdNorm = tight.md;
      }
    }

    const parsed = parseClaims(o.claims, GEN_LIMITS.claimsPerBlock, GEN_LIMITS.citesPerClaim);
    if (parsed.unknownKeys > 0) c.warn("W02");
    if (parsed.aliased > 0) c.warn("W09");
    for (const p of parsed.problems) c.err("V03", p.at, p.expected, p.actual);
    let claims = parsed.claims;
    // a diagram caption is shown under its drawing, where markers are not rendered as cites, and the flow's steps carry
    // the claims: both are dropped (W10) [real run 2026-10-04: a raw [[1]] under every m3e sequence diagram]
    if (kind === "diagram" && mdOk && (claims.length > 0 || scanMarkers(mdNorm).length > 0)) {
      mdNorm = stripMarkers(mdNorm);
      claims = [];
      c.warn("W10");
    }
    // patch lines without "claims" (doc.translate / doc.simplify) keep the block's claims: markers [[1]]..[[n]] once each
    if (mdOk && patch && o.claims === undefined && existing) this.inheritedMarkers(mdNorm, existing.claims, c);
    else if (mdOk) {
      if (parsed.problems.length === 0) ({ md: mdNorm, claims } = this.repairMarkers(mdNorm, claims, c));
      this.markers(mdNorm, claims, c);
    }
    claims = claims.map((cl) => this.claimCites(cl, c));

    let after: BlockId | NewBlockRef | undefined;
    if (o.after !== undefined) {
      const a = o.after;
      if (typeof a === "string" && BLOCK_ID_RE.test(a)) {
        if (!ctx.existing.has(a as BlockId)) c.err("V04", "/after", "an id listed in EXISTING", a);
        else after = a as BlockId;
      } else if (typeof a === "string" && NEW_REF_RE.test(a)) {
        if (!this.newRefs.has(a)) c.err("V04", "/after", "a new:<n> written on an earlier line", a);
        else after = a as NewBlockRef;
      } else c.err("V03", "/after", "a block id or new:<n>", a);
    }

    if (!c.ok || section === null) return null;
    if (ref) this.newRefs.add(ref);
    else this.accounted.add(id as BlockId);
    this.accepted.push({ section, aspect });
    const value: GenBlockLine = { t: "block", id: ref ?? (id as BlockId), section, md: mdNorm, claims };
    if (aspect) value.aspect = aspect;
    if (kind) value.kind = kind;
    if (depth) value.depth = depth;
    if (audience) value.audience = audience;
    if (diagram) value.diagram = diagram;
    if (after) value.after = after;
    return value;
  }

  private aspect(raw: unknown, c: LineCheck): BlockAspect | undefined {
    if (raw === undefined) {
      c.err("V03", "/aspect", "aspect is required", "missing");
      return undefined;
    }
    if (typeof raw !== "string") {
      c.err("V03", "/aspect", "aspect string", raw);
      return undefined;
    }
    const norm = raw.trim().toLowerCase().replace(/-/g, "_");
    if (!BLOCK_ASPECTS.has(norm)) {
      c.err("V06", "/aspect", "an aspect the task allows", raw);
      return undefined;
    }
    if (norm !== raw) c.warn("W03");
    return norm as BlockAspect;
  }

  /** Resolve the block's section: explicit (W03-normalized) or derived from the aspect / current flow. */
  private section(raw: unknown, aspect: BlockAspect | undefined, c: LineCheck): SectionId | null {
    const ctx = this.ctx;
    if (raw !== undefined) {
      if (typeof raw !== "string") {
        c.err("V03", "/section", "section string", raw);
        return null;
      }
      const norm = this.normalizeSection(raw);
      if (!norm) {
        c.err("V05", "/section", `one of ${this.sectionList()}`, raw);
        return null;
      }
      if (norm !== raw) c.warn("W03");
      if (this.flowsEnabled && norm.startsWith("s3/") && !this.flowKeys.includes(norm.slice(3))) {
        c.err("V24", "/section", `the flow line of "${norm.slice(3)}" before its blocks`, raw);
        return null;
      }
      return norm;
    }
    if (aspect && this.flowsEnabled && FLOW_ASPECTS.includes(aspect)) {
      const last = this.flowKeys.at(-1);
      if (!last) {
        c.err("V24", "/aspect", "a flow line before the blocks of a flow", aspect);
        return null;
      }
      // a flow has one block per aspect: when the current flow already has this one, the block belongs to the first
      // flow that lacks it (a retry adds the missing steps of an earlier flow; real run 2026-10-04: m3e §3 failed)
      const taken = (k: string) => this.accepted.some((x) => x.section === `s3/${k}` && x.aspect === aspect);
      const key = taken(last) ? (this.flowKeys.find((k) => !taken(k)) ?? last) : last;
      return `s3/${key}`;
    }
    if (aspect) for (const s of ctx.sections) if (ctx.aspectsOf(s).includes(aspect)) return s;
    return ctx.primarySection;
  }

  private normalizeSection(raw: string): SectionId | null {
    const ctx = this.ctx;
    const allowed = (s: string) =>
      SECTION_RE.test(s) && (ctx.sections.includes(s as SectionId) || (this.flowsEnabled && /^s3\/[a-z0-9][a-z0-9-]{0,31}$/.test(s)));
    if (allowed(raw)) return raw as SectionId;
    const n = raw.trim().toLowerCase().replace(/_/g, "-");
    if (allowed(n)) return n as SectionId;
    if (!n.includes("/")) {
      for (const s of ctx.sections) if (s.includes("/") && s.slice(s.indexOf("/") + 1) === n) return s;
      if (this.flowsEnabled && this.flowKeys.includes(n)) return `s3/${n}`;
      return null;
    }
    // a task section with the aspect (or any sub-path) appended: `s10/decision`, `s6/app/interface` [real run 2026-10-04]
    const prefix = [...ctx.sections].sort((a, b) => b.length - a.length).find((s) => n.startsWith(`${s}/`));
    if (prefix && !(this.flowsEnabled && prefix === "s3")) return prefix;
    return null;
  }

  private sectionList(): string {
    return [...this.ctx.sections, ...(this.flowsEnabled ? ["s3/<key>"] : [])].join(", ");
  }

  private kind(raw: unknown, aspect: BlockAspect, c: LineCheck): BlockKind | undefined {
    const allowed = kindsOf(aspect);
    if (raw === undefined) {
      if (this.ctx.form === "full") c.err("V03", "/kind", "kind is required in the full form", "missing");
      return allowed[0];
    }
    if (typeof raw !== "string" || !LINE_KINDS.has(raw)) {
      c.err("V03", "/kind", "a block kind", raw);
      return undefined;
    }
    if (!allowed.includes(raw as BlockKind)) {
      c.err("V07", "/kind", `one of ${allowed.join(", ")} for aspect ${aspect}`, raw);
      return undefined;
    }
    return raw as BlockKind;
  }

  private depth(raw: unknown, aspect: BlockAspect, c: LineCheck): Depth | undefined {
    const def = ASPECT_DEFAULTS[aspect].depth;
    if (raw === undefined) {
      if (this.ctx.form === "full") c.err("V03", "/depth", "depth is required in the full form", "missing");
      return def;
    }
    const i = DEPTHS.indexOf(raw as Depth);
    if (i < 0) {
      c.err("V03", "/depth", "one of L0, L1, L2, L3", raw);
      return undefined;
    }
    if (Math.abs(i - DEPTHS.indexOf(def)) > 1) {
      c.err("V08", "/depth", `${def} ± 1 for aspect ${aspect}`, raw);
      return undefined;
    }
    return raw as Depth;
  }

  private audience(raw: unknown, aspect: BlockAspect, c: LineCheck): Audience[] | undefined {
    if (raw === undefined) {
      if (this.ctx.form === "full") c.err("V03", "/audience", "audience is required in the full form", "missing");
      return [...ASPECT_DEFAULTS[aspect].audience];
    }
    if (
      !Array.isArray(raw) ||
      raw.length < 1 ||
      raw.length > 3 ||
      new Set(raw).size !== raw.length ||
      !raw.every((a) => typeof a === "string" && AUDIENCES.has(a))
    ) {
      c.err("V03", "/audience", "1 to 3 distinct of newcomer, dev, reviewer, pm, sre", raw);
      return undefined;
    }
    return raw as Audience[];
  }

  private mdLimit(kind: BlockKind | undefined, aspect: BlockAspect | undefined): number {
    const factor = this.ctx.lang === "en" ? GEN_LIMITS.enFactor : 1;
    if (aspect === "deepdive" && this.ctx.prompt === "gen.module") return Math.round(GEN_LIMITS.deepdivePlaceholderChars * factor);
    const base = kind ? (GEN_LIMITS.mdChars as Readonly<Record<string, number>>)[kind] : undefined;
    return base === undefined ? Number.POSITIVE_INFINITY : Math.round(base * factor);
  }

  /** V14: the `[[n]]` markers outside code must match the claim numbers one to one. */
  private markers(md: string, claims: readonly GenClaimDraft[], c: LineCheck): void {
    const markers = scanMarkers(md);
    const seen = new Set<number>();
    for (const m of markers) {
      if (seen.has(m.n)) c.err("V14", "/md", `marker [[${m.n}]] exactly once`, "repeated");
      seen.add(m.n);
    }
    const claimNs = new Set<number>();
    for (const cl of claims) {
      if (claimNs.has(cl.n)) c.err("V14", `/claims/${cl.n}`, `claim ${cl.n} listed once`, "repeated");
      claimNs.add(cl.n);
    }
    const inCode = markersInCode(md);
    for (const n of claimNs) {
      if (!seen.has(n)) c.err("V14", `/claims/${n}`, `marker [[${n}]] in md for claim ${n}`, inCode.has(n) ? "marker only inside a code span" : "no marker");
    }
    for (const n of seen) if (!claimNs.has(n)) c.err("V14", "/md", `claim ${n} for marker [[${n}]]`, "no claim");
  }

  /** V14 for a patch line that inherits the block's `n` claims: the marker set must be exactly 1..n (§12 V14). */
  private inheritedMarkers(md: string, n: number, c: LineCheck): void {
    const seen = new Set<number>();
    for (const m of scanMarkers(md)) {
      if (seen.has(m.n)) c.err("V14", "/md", `marker [[${m.n}]] exactly once`, "repeated");
      else if (m.n > n) c.err("V14", "/md", `markers [[1]]..[[${n}]] of the original block`, `[[${m.n}]]`);
      seen.add(m.n);
    }
    const inCode = markersInCode(md);
    for (let k = 1; k <= n; k++)
      if (!seen.has(k)) c.err("V14", "/md", `marker [[${k}]] of the original block`, inCode.has(k) ? "marker only inside a code span" : "no marker");
  }

  /**
   * W10 before V14: an orphan marker (a marker whose claim is missing) becomes an inferred claim — the sentence was
   * meant as a claim and has no proof, which is exactly what "inferred" shows; a block that has claims but no
   * marker at all gets one marker per sentence / list item when they are equally many ({@link placeMarkers}).
   * Anything else is left to V14 (retried). Only for lines whose claims parsed cleanly.
   */
  private repairMarkers(md: string, claims: GenClaimDraft[], c: LineCheck): { md: string; claims: GenClaimDraft[] } {
    const markers = scanMarkers(md);
    const claimNs = new Set(claims.map((cl) => cl.n));
    let out = claims;
    let outMd = md;
    let repaired = false;
    if (markers.length === 0 && claims.length > 0) {
      const placed = placeMarkers(
        md,
        claims.map((cl) => cl.n),
      );
      if (placed !== null) {
        outMd = placed;
        repaired = true;
      }
    } else if (new Set(markers.map((m) => m.n)).size === markers.length) {
      // (a repeated marker is V14 whatever claims exist: no repair then)
      const orphans = markers.map((m) => m.n).filter((n) => !claimNs.has(n));
      if (orphans.length > 0 && orphans.length + claims.length <= GEN_LIMITS.claimsPerBlock) {
        out = [...claims, ...orphans.map((n): GenClaimDraft => ({ n, kind: "fact", cites: [] }))].sort((a, b) => a.n - b.n);
        repaired = true;
      }
    }
    if (repaired) c.warn("W10");
    return { md: outMd, claims: out };
  }

  /** V17 / V18 of a claim's cites; an unshown cite (V17) is dropped (W11) while the claim keeps another valid cite. */
  private claimCites(cl: GenClaimDraft, c: LineCheck): GenClaimDraft {
    const keep: RawCite[] = [];
    const unshown: { j: number; problem: CiteProblem }[] = [];
    for (const [j, cite] of cl.cites.entries()) {
      const p = this.citeProblem(cite, c);
      if (p === null) keep.push(cite);
      else if (p.rule === "V17") unshown.push({ j, problem: p });
      else c.err(p.rule, `/claims/${cl.n}/${j}`, p.expected, p.actual);
    }
    if (unshown.length === 0) return cl;
    if (keep.length > 0 && keep.length + unshown.length === cl.cites.length) {
      c.warn("W11");
      return { ...cl, cites: keep };
    }
    for (const u of unshown) c.err("V17", `/claims/${cl.n}/${u.j}`, u.problem.expected, u.problem.actual);
    return cl;
  }

  /** V17 / V18 with an error for a question cite. */
  private cite(cite: RawCite, at: string, c: LineCheck): void {
    const p = this.citeProblem(cite, c);
    if (p) c.err(p.rule, at, p.expected, p.actual);
  }

  /** V17 / V18 with the W04 repairs applied virtually (the Verifier performs and records them); null = citable. */
  private citeProblem(cite: RawCite, c: LineCheck): CiteProblem | null {
    const lines = this.ctx.citable.lines(cite.path);
    if (lines === null) return { rule: "V17", expected: "a path shown in the task", actual: cite.path };
    let { start, end } = cite;
    const slack = GEN_LIMITS.citeClampSlack;
    let repaired = false;
    if (start === 0) {
      start = 1;
      repaired = true;
    }
    if (start > end && start - end <= slack) {
      [start, end] = [end, start];
      repaired = true;
    }
    if (end > lines && end - lines <= slack) {
      end = lines;
      repaired = true;
    }
    if (!(start >= 1 && start <= end && end <= lines) || end - start >= GEN_LIMITS.citeMaxSpan)
      return {
        rule: "V18",
        expected: `1 ≤ start ≤ end ≤ ${lines} and fewer than ${GEN_LIMITS.citeMaxSpan} lines`,
        actual: `${cite.path}:${cite.start}-${cite.end}`,
      };
    if (repaired) c.warn("W04");
    if (!this.ctx.citable.allows(cite.path, start, end))
      return { rule: "V17", expected: "lines shown in the task (N| lines, FACTS locations or given cites)", actual: `${cite.path}:${cite.start}-${cite.end}` };
    return null;
  }

  private keepDelete(t: "keep" | "delete", o: Record<string, unknown>, c: LineCheck): GenLine | null {
    const id = o.id;
    if (typeof id !== "string" || !BLOCK_ID_RE.test(id)) c.err("V03", "/id", "a block id", id);
    else if (!this.ctx.existing.has(id as BlockId)) c.err("V29", "/id", "an id listed in EXISTING (static and unlisted blocks are never kept or deleted)", id);
    else if (this.accounted.has(id as BlockId)) c.err("V26", "/id", "each EXISTING id accounted once", id);
    if (!c.ok) return null;
    this.accounted.add(id as BlockId);
    return { t, id: id as BlockId };
  }

  private module(o: Record<string, unknown>, c: LineCheck): GenLine | null {
    const lang = this.ctx.lang;
    const m = o.module;
    if (typeof m !== "string" || !MODULE_RE.test(m)) c.err("V03", "/module", "a module id md_…", m);
    else if (!this.ctx.modules.has(m as ModuleId)) c.err("V23", "/module", "a module of this task", m);
    const name = o.name;
    if (typeof name !== "string" || name.length < 1 || name.length > 40) c.err("V03", "/name", "name string 1..40", name);
    else if (charCount(name) > GEN_LIMITS.nameChars[lang]) c.err("V23", "/name", `name ≤ ${GEN_LIMITS.nameChars[lang]} chars`, name);
    const summary = o.summary;
    if (summary !== undefined) {
      if (typeof summary !== "string" || summary.length > 120) c.err("V03", "/summary", "summary string ≤ 120", summary);
      else if (charCount(summary) > GEN_LIMITS.summaryChars[lang]) c.err("V23", "/summary", `summary ≤ ${GEN_LIMITS.summaryChars[lang]} chars`, summary);
    }
    if (!c.ok) return null;
    this.moduleLines.add(m as ModuleId);
    const line: GenLine = { t: "module", module: m as ModuleId, name: name as string };
    if (typeof summary === "string") line.summary = summary;
    return line;
  }

  private flow(o: Record<string, unknown>, c: LineCheck): GenLine | null {
    const lang: DocLang = this.ctx.lang;
    const key = o.key;
    if (typeof key !== "string" || !FLOW_KEY_RE.test(key)) c.err("V03", "/key", "key [a-z0-9][a-z0-9-]{0,31}", key);
    else if (this.flowKeys.includes(key)) c.err("V24", "/key", "a new flow key", key);
    else if (this.flowKeys.length >= this.ctx.flows.max) c.err("V24", "/key", `at most ${this.ctx.flows.max} flows`, key);
    const title = o.title;
    if (typeof title !== "string" || title.length < 1 || title.length > 60) c.err("V03", "/title", "title string 1..60", title);
    else if (charCount(title) > GEN_LIMITS.flowTitleChars[lang]) c.err("V24", "/title", `title ≤ ${GEN_LIMITS.flowTitleChars[lang]} chars`, title);
    if (!c.ok) return null;
    this.flowKeys.push(key as string);
    return { t: "flow", key: key as string, title: title as string };
  }

  private term(o: Record<string, unknown>, c: LineCheck): GenLine | null {
    const lang = this.ctx.lang;
    const term = o.term;
    if (typeof term !== "string" || term.length < 1 || term.length > GEN_LIMITS.termChars)
      c.err("V03", "/term", `term string 1..${GEN_LIMITS.termChars}`, term);
    const def = o.def;
    if (typeof def !== "string" || def.length < 1 || def.length > 300) c.err("V03", "/def", "def string 1..300", def);
    else if (charCount(def) > GEN_LIMITS.termDefChars[lang]) c.err("V22", "/def", `def ≤ ${GEN_LIMITS.termDefChars[lang]} chars`, def);
    else if (sentenceCount(def) > 3) c.err("V22", "/def", "at most 3 sentences", def);
    const yomi = o.yomi;
    if (yomi === undefined) {
      if (lang === "ja") c.err("V22", "/yomi", "a hiragana reading (required for Japanese)", "missing");
    } else if (typeof yomi !== "string" || !YOMI_RE.test(yomi)) c.err("V22", "/yomi", "hiragana only (ー allowed), 1..40", yomi);
    const en = o.en;
    if (en !== undefined && (typeof en !== "string" || en.length > 60)) c.err("V03", "/en", "en string ≤ 60", en);
    if (!c.ok) return null;
    const line: GenLine = { t: "term", term: term as string, def: def as string };
    if (typeof yomi === "string") line.yomi = yomi;
    if (typeof en === "string") line.en = en;
    return line;
  }

  private question(o: Record<string, unknown>, c: LineCheck): GenLine | null {
    const text = o.text;
    if (typeof text !== "string" || text.length < 1 || text.length > GEN_LIMITS.questionChars)
      c.err("V03", "/text", `text string 1..${GEN_LIMITS.questionChars}`, text);
    let section: SectionId | undefined;
    if (o.section !== undefined) {
      if (typeof o.section !== "string") c.err("V03", "/section", "section string", o.section);
      else {
        const norm = this.normalizeSection(o.section);
        if (!norm) c.err("V05", "/section", `one of ${this.sectionList()}`, o.section);
        else {
          if (norm !== o.section) c.warn("W03");
          section = norm;
        }
      }
    }
    const cites: RawCite[] = [];
    if (o.cites !== undefined) {
      if (!Array.isArray(o.cites) || o.cites.length > GEN_LIMITS.citesPerClaim) c.err("V03", "/cites", `array of ≤ ${GEN_LIMITS.citesPerClaim} cites`, o.cites);
      else
        for (const [j, x] of o.cites.entries()) {
          const p = parseCiteObject(x);
          if (typeof p === "string") {
            c.err("V03", `/cites/${j}`, p, x);
            continue;
          }
          if (p.unknown > 0) c.warn("W02");
          this.cite(p.cite, `/cites/${j}`, c);
          cites.push(p.cite);
        }
    }
    let from: string[] | undefined;
    if (o.from !== undefined) {
      if (!Array.isArray(o.from) || !o.from.every((x) => typeof x === "string" && RAW_Q_RE.test(x))) c.err("V03", "/from", 'array of "q<k>" ids', o.from);
      else from = o.from as string[];
    }
    if (!c.ok) return null;
    const line: GenLine = { t: "question", text: text as string };
    if (section) line.section = section;
    if (cites.length > 0) line.cites = cites;
    if (from) line.from = from;
    return line;
  }

  private verdictLine(o: Record<string, unknown>, c: LineCheck): GenLine | null {
    if (typeof o.claim !== "string" || !CLAIM_ID_RE.test(o.claim)) c.err("V03", "/claim", "a claim id cl_…", o.claim);
    if (o.v !== "S" && o.v !== "P" && o.v !== "U") c.err("V03", "/v", "one of S, P, U", o.v);
    if (!c.ok) return null;
    return { t: "verdict", claim: o.claim as `cl_${string}`, v: o.v as "S" | "P" | "U" };
  }

  private end(o: Record<string, unknown>, c: LineCheck): GenLine | null {
    const n = o.blocks;
    if (!Number.isInteger(n) || (n as number) < 0) c.err("V03", "/blocks", "integer ≥ 0", n);
    if (!c.ok) return null;
    if (n !== this.blockLines) c.warn("W05"); // informational only: coverage is checked independently
    this.endSeen = true;
    return { t: "end", blocks: n as number };
  }
}
