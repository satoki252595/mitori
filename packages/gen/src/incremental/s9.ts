/**
 * Incremental S9 (gen spec §11): static marking (0 tokens) and suggestions (never run automatically, D12).
 * 1. Marking: claims whose cited range overlapped a change or could not be re-anchored become `stale` (their blocks
 *    `freshness: stale`), moved cites take their new ranges. The composition root already does this in the
 *    re-anchoring slot (DOMAIN_WIRING W1/W2); here it is idempotent — only what is not marked yet is written.
 * 2. Early cutoff R1–R8 (`rules.ts`) over the generated sections, the claim states and the baselines (`state.ts`).
 * 3. Every suggestion gets a stored, startable estimate of its scoped run (trigger `incremental`, lane `doc`) and an id
 *    that stays the same while the same suggestion is pending. The list replaces the previous one (its estimates
 *    are dropped), so a later delta that changes nothing for a unit keeps that unit's suggestion.
 * Static sections are refreshed by the composition root (`applyStatic` after this step), not here.
 */
import { type Block, type BlockId, base32, type ClaimId, type ModuleId, type SectionId, type SuggestionId } from "@mitori/core";
import type { IncrementalInput, IncrementalOutcome, IncrementalSuggestion } from "../contract.ts";
import type { OnDemand } from "../ondemand/ondemand.ts";
import { labelsPlan, scopedPlan, syncTasks } from "../ondemand/plan.ts";
import type { Services } from "../orchestrator/runner.ts";
import type { TaskRow } from "../orchestrator/store.ts";
import { evaluate, type SuggestionSpec, type Unit, unitOf } from "./rules.ts";
import { fingerprints, loadState, type S9State, saveState } from "./state.ts";

/** The S9 step of one workspace. */
export class Incremental {
  constructor(
    private readonly svc: Services,
    private readonly od: OnDemand,
  ) {}

  private get deps() {
    return this.svc.deps;
  }

  async onIndexDelta(input: IncrementalInput): Promise<IncrementalOutcome> {
    const deps = this.deps;
    const t0 = deps.clock.now();
    const marked = await this.mark(input);
    const state = loadState(deps.db);
    this.seed(state);
    const units = this.units(new Set(input.excludeBlocks ?? []));
    const unlabeled = this.unlabeled();
    const specs = evaluate({ units, base: state, now: fingerprints(deps.indexer, deps.hasher), unlabeled });
    const suggestions: IncrementalSuggestion[] = [];
    for (const spec of specs) {
      const s = await this.suggest(spec, unlabeled);
      if (s) suggestions.push(s);
    }
    const keep = new Set(suggestions.map((s) => s.estimate.id));
    const drop = state.estimates.filter((id) => !keep.has(id));
    state.estimates = [...keep];
    await deps.write("gen.s9", () => {
      saveState(deps.db, state);
      this.svc.store.deleteEstimates(drop);
    });
    return { ...marked, staticRefreshed: [], suggestions, ms: deps.clock.now() - t0 };
  }

  /**
   * A task finished (inside its write slot): the section it wrote is now generated against the current index.
   * Module pages take the module's interface digest; §3 the flow facts; §7 the schema; the final overview the structure.
   */
  taskDone(row: TaskRow): void {
    const deps = this.deps;
    const p = row.plan.prompt;
    if (p !== "gen.module" && p !== "gen.parent" && p !== "gen.flows" && p !== "gen.datamodel" && !(p === "gen.overview" && row.plan.mode === "final")) return;
    const state = loadState(deps.db);
    if (p === "gen.module" || p === "gen.parent") {
      const m = deps.indexer.module(row.plan.target.id as ModuleId);
      if (!m) return;
      state.iface[m.id] = m.ifaceDigest;
    } else {
      const fp = fingerprints(deps.indexer, deps.hasher);
      if (p === "gen.flows") state.flows = fp.flows;
      else if (p === "gen.datamodel") state.schema = fp.schema;
      else state.structure = fp.structure;
    }
    saveState(deps.db, state);
  }

  /** §11.2: stale / moved claims (idempotent over the composition root's own marking). */
  private async mark(input: IncrementalInput): Promise<Pick<IncrementalOutcome, "staleClaims" | "staleBlocks" | "movedClaims">> {
    const doc = this.deps.doc;
    const claims = doc.index().claims;
    const at = this.deps.clock.iso();
    const staleClaims = [...new Set<ClaimId>([...input.claims.overlapped, ...input.claims.outdated])].filter((id) => claims[id] !== undefined).sort();
    const updates: Parameters<typeof doc.setClaimChecks>[0] = [];
    const staleBlocks = new Set<BlockId>();
    for (const id of staleClaims) {
      const c = claims[id];
      if (!c) continue;
      staleBlocks.add(c.block);
      if (c.verdict !== "stale") updates.push({ id, checks: { ...c.checks, l2: false, checkedAt: at }, verdict: "stale" });
    }
    const movedClaims: ClaimId[] = [];
    for (const m of input.claims.moved) {
      const c = claims[m.claim];
      if (!c) continue;
      movedClaims.push(m.claim);
      const same = c.cites.length === m.cites.length && c.cites.every((x, i) => sameCite(x, m.cites[i]));
      if (!same) updates.push({ id: m.claim, checks: { ...c.checks, checkedAt: at }, cites: m.cites });
    }
    const fresh = [...staleBlocks].filter((b) => doc.block(b)?.freshness !== "stale");
    if (updates.length > 0 || fresh.length > 0)
      await this.deps.write("gen.s9.mark", () => {
        if (updates.length > 0) doc.setClaimChecks(updates);
        if (fresh.length > 0) doc.setFreshness(fresh, "stale");
      });
    return { staleClaims, staleBlocks: [...staleBlocks].sort(), movedClaims: movedClaims.sort() };
  }

  /** Content blocks of a section (generated or human text; no headings, statics or placeholders). */
  private content(section: SectionId): Block[] {
    return (this.deps.doc.section(section)?.blocks ?? []).filter((b) => b.origin !== "static" && b.status !== "placeholder" && b.kind !== "placeholder");
  }

  /**
   * First sight of a generated module page without a baseline: the doc index still holds the digest of the last
   * static apply — the page's generation input — because the composition root re-applies statics after S9.
   */
  private seed(state: S9State): void {
    const ix = this.deps.indexer;
    for (const e of this.deps.doc.index().modules) if (state.iface[e.id] === undefined && this.content(e.section).length > 0) state.iface[e.id] = e.ifaceDigest;
    for (const id of Object.keys(state.iface) as ModuleId[]) if (!ix.module(id)) delete state.iface[id];
    const fp = fingerprints(ix, this.deps.hasher);
    const has = (...sections: SectionId[]) => sections.some((s) => this.content(s).length > 0);
    if (state.flows === undefined && has("s3", ...this.deps.doc.sections().flatMap((s) => (s.id.startsWith("s3/") ? [s.id] : [])))) state.flows = fp.flows;
    if (state.schema === undefined && has("s7")) state.schema = fp.schema;
    if (state.structure === undefined && has("s0", "s1", "s2")) state.structure = fp.structure;
  }

  /** Units with generated content and their claim counts (excluded blocks and blocks awaiting a proposal don't count). */
  private units(exclude: ReadonlySet<BlockId>): Unit[] {
    const doc = this.deps.doc;
    const ix = this.deps.indexer;
    const bySection = new Map(doc.index().modules.map((e) => [e.section, e.id]));
    const pending = new Set<BlockId>();
    for (const p of doc.proposals({ state: "pending" })) if (p.block && p.baseHash === doc.block(p.block)?.hash) pending.add(p.block);
    const units = new Map<SectionId, Unit>();
    for (const s of doc.sections()) {
      const moduleId = bySection.get(s.id);
      const unit = unitOf(s.id, moduleId !== undefined);
      if (unit === null) continue;
      const blocks = this.content(s.id);
      if (blocks.length === 0) continue;
      let u = units.get(unit);
      if (!u) {
        u = { section: unit, blocks: [] };
        if (moduleId !== undefined) {
          const m = ix.module(moduleId);
          if (!m) continue; // the module is gone; the static refresh removes its section
          u.module = { id: m.id, leaf: m.children.length === 0, children: m.children, iface: m.ifaceDigest };
        }
        units.set(unit, u);
      }
      for (const b of blocks) {
        if (exclude.has(b.id) || pending.has(b.id)) continue;
        const cs = doc.claims(b.id);
        u.blocks.push({ id: b.id, total: cs.length, stale: cs.filter((c) => c.verdict === "stale").length });
      }
    }
    return [...units.values()];
  }

  /**
   * Modules without a page that still carry their provisional name (the labels R7 suggests). A module the doc does
   * not know yet (the static refresh runs after S9) counts as unlabeled.
   */
  private unlabeled(): ModuleId[] {
    const entries = new Map(this.deps.doc.index().modules.map((e) => [e.id, e]));
    const out: ModuleId[] = [];
    for (const m of this.deps.indexer.modules()) {
      const e = entries.get(m.id);
      if (!e || (e.name === m.name && this.content(e.section).length === 0)) out.push(m.id);
    }
    return out;
  }

  /** Estimate a suggestion's scoped run and give it its id (null when no prompt can run it). */
  private async suggest(spec: SuggestionSpec, unlabeled: readonly ModuleId[]): Promise<IncrementalSuggestion | null> {
    const env = this.od.scope();
    const engine = this.od.engine();
    let plan: ReturnType<typeof scopedPlan>;
    if (spec.kind === "sync") {
      const blocks = this.od.staleBlocks(spec.blocks);
      if (blocks.length === 0) return null;
      plan = scopedPlan(env, engine, syncTasks(env, engine, blocks));
    } else if (spec.prompt === "gen.labels") plan = labelsPlan(env, engine, unlabeled);
    else {
      const tasks = this.od.sectionTasks(spec.section);
      if (tasks.length === 0) return null;
      plan = scopedPlan(env, engine, tasks);
    }
    const { estimate } = await this.od.prepare(plan, "incremental", { suggestion: true });
    return { id: suggestionId(this.deps.hasher, spec), ...spec, estimate };
  }
}

function sameCite(a: { path: string; start: number; end: number; blob: string; snippet: string }, b: typeof a | undefined): boolean {
  return b !== undefined && a.path === b.path && a.start === b.start && a.end === b.end && a.blob === b.blob && a.snippet === b.snippet;
}

/** Deterministic id: the same suggestion keeps its id across recomputations while it is pending. */
export function suggestionId(hasher: { xxh3(s: string): string }, s: SuggestionSpec): SuggestionId {
  const hex = hasher.xxh3(`${s.section}|${s.rule}|${s.kind}|${s.prompt}|${s.blocks.join(",")}`);
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return `sg_${base32(bytes).slice(0, 8)}`;
}
