/**
 * Deterministic planner (gen spec §3.2–§3.4, R1: the 7 M2 prompts). Effort → task DAG with hard deps, phases
 * (session packets), model / effort per prompt mode and raw estimates. Task ids are content-derived
 * (`gt_` + base32(xxh3(prompt|mode|target))) so the plan's canonical JSON is byte-stable (AC-01).
 * standard = top `min(40, leaves)` leaves by (entry/route/cli desc, rank desc, id asc); complete = all leaves;
 * overview = none. M4 sections (datamodel, quality, decisions, risks, questions) stay static + placeholder.
 */
import {
  base32,
  type EffectiveSettings,
  type EngineId,
  type GenEstimateReq,
  type GenTaskId,
  type Hasher,
  type ModuleId,
  type ModuleInfo,
  type SectionId,
} from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { DATA_BUDGETS, GEN_ESTIMATE_PARAMS, type GenEstimator, type GenPlan, type GenPlanner, type GenPromptId, type PlannedTask } from "../contract.ts";
import { LABELS_PER_CALL, labelModules } from "../prompts/inputs.ts";
import { UNIT_TEMPLATES } from "../prompts/templates.ts";
import { compareTasks, groupOf, modelOf } from "./params.ts";

/** Ports of the planner. */
export interface PlannerDeps {
  /** Index. */
  indexer: Indexer;
  /** Doc (existing content: early overview skip, scope deps). */
  doc: DocStore;
  /** Settings. */
  settings: () => EffectiveSettings;
  /** Hasher (task ids). */
  hasher: Hasher;
  /** Estimator (raw per-task figures). */
  estimator: GenEstimator;
}

/** Engine of a request: request ▸ workspace override ▸ global default. */
export function engineOf(req: GenEstimateReq, s: EffectiveSettings): EngineId {
  return req.engine ?? s.overrides.defaultGenEngine ?? s.global.defaultGenEngine;
}

/** Deterministic task id. */
export function planTaskId(hasher: Hasher, prompt: GenPromptId, mode: string | undefined, target: { kind: string; id: string }): GenTaskId {
  const hex = hasher.xxh3(`${prompt}|${mode ?? ""}|${target.kind}:${target.id}`);
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return `gt_${base32(bytes).slice(0, 10)}`;
}

type Draft = Omit<PlannedTask, "id" | "model" | "effort" | "lane" | "cacheKey" | "cached" | "estimate"> & { tail: number; out?: number };

/** Factory. */
export function createPlanner(deps: PlannerDeps): GenPlanner {
  const ix = deps.indexer;
  const tokens = (t: string) => ix.estimateTokens(t, "code", "claude-v5");

  function hasAiContent(sections: readonly SectionId[]): boolean {
    return sections.some((s) => (deps.doc.section(s)?.blocks ?? []).some((b) => b.origin !== "static" && b.status !== "placeholder"));
  }

  return {
    plan(req: GenEstimateReq): GenPlan {
      const s = deps.settings();
      const engine = engineOf(req, s);
      const mods = ix.modules();
      const byId = new Map(mods.map((m) => [m.id, m]));
      const leaves = mods.filter((m) => m.children.length === 0);
      const entryPaths = new Set(
        ix
          .facts()
          .filter((f) => f.kind === "entry" || f.kind === "route" || f.kind === "cli")
          .map((f) => f.path),
      );
      const hasEntry = (m: ModuleInfo) => m.paths.some((p) => entryPaths.has(p));
      const ordered = [...leaves].sort((a, b) => Number(hasEntry(b)) - Number(hasEntry(a)) || b.rank - a.rank || (a.id < b.id ? -1 : 1));
      const eagerList =
        req.effort === "overview" ? [] : req.effort === "complete" ? ordered : ordered.slice(0, Math.min(GEN_ESTIMATE_PARAMS.standardEagerMax, ordered.length));
      const eager = new Set<ModuleId>(eagerList.map((m) => m.id));
      const unit = (p: GenPromptId) => tokens(UNIT_TEMPLATES[p] ?? "");
      const drafts: Draft[] = [];
      const add = (d: Draft) => {
        drafts.push(d);
        return d;
      };

      const early = !hasAiContent(["s0", "s1", "s2"])
        ? add({
            stage: "S6o",
            prompt: "gen.overview",
            mode: "early",
            target: { kind: "overview", id: "early" },
            sections: ["s0", "s1", "s2"],
            deps: [],
            softDeps: [],
            topoOrder: 0,
            rank: 0,
            phase: 1,
            tail: overviewTail(false),
          })
        : null;

      const pageOf = new Map<ModuleId, Draft>();
      for (const m of eagerList) {
        const ctxTokens = ix.moduleContext(m.id, { tokenizer: "claude-v5", budget: 28000, tier: "sig" }).tokens.total;
        const stats = ix.moduleStats(m.id);
        const depsTokens = 25 * ((stats?.depsOut.length ?? 0) + (stats?.depsIn.length ?? 0));
        pageOf.set(
          m.id,
          add({
            stage: "S5",
            prompt: "gen.module",
            target: { kind: "module", id: m.id },
            sections: [`s6/${m.slug}`],
            deps: [],
            softDeps: [],
            topoOrder: m.topoOrder,
            rank: m.rank,
            phase: 1,
            tail: 80 + depsTokens + ctxTokens + unit("gen.module"),
          }),
        );
      }

      // S6 parents with ≥ 1 paged child, deepest first; phase = 1 + height above the leaves
      const height = new Map<ModuleId, number>();
      const heightOf = (m: ModuleInfo): number => {
        const known = height.get(m.id);
        if (known !== undefined) return known;
        const h = m.children.length === 0 ? 0 : 1 + Math.max(...m.children.map((c) => (byId.get(c) ? heightOf(byId.get(c) as ModuleInfo) : 0)));
        height.set(m.id, h);
        return h;
      };
      const parents = mods
        .filter((m) => m.children.length > 0)
        .sort((a, b) => heightOf(a) - heightOf(b) || a.topoOrder - b.topoOrder || (a.id < b.id ? -1 : 1));
      if (req.effort !== "overview") {
        for (const p of parents) {
          const childPages = p.children.map((c) => pageOf.get(c)).filter((d): d is Draft => d !== undefined);
          if (childPages.length === 0) continue;
          const childSig = p.children.reduce((n, c) => n + ix.skeleton({ kind: "module", module: c }, "sig", "claude-v5").tokens, 0);
          pageOf.set(
            p.id,
            add({
              stage: "S6",
              prompt: "gen.parent",
              target: { kind: "parent", id: p.id },
              sections: [`s6/${p.slug}`],
              deps: childPages.map(draftId),
              softDeps: [],
              topoOrder: p.topoOrder,
              rank: p.rank,
              phase: 1 + heightOf(p),
              tail:
                80 +
                Math.min(DATA_BUDGETS["gen.parent"].CHILDREN, 150 * p.children.length) +
                Math.min(DATA_BUDGETS["gen.parent"].SKELETON, childSig) +
                unit("gen.parent"),
            }),
          );
        }
      }

      const planTasksSoFar = drafts.filter((d) => d.prompt === "gen.parent").map((d) => ({ prompt: d.prompt, target: d.target }) as PlannedTask);
      const toLabel = labelModules(ix, { eager: [...eager], tasks: planTasksSoFar });
      const labels: Draft[] = [];
      for (let k = 0; k * LABELS_PER_CALL < toLabel.length; k++) {
        const n = Math.min(LABELS_PER_CALL, toLabel.length - k * LABELS_PER_CALL);
        labels.push(
          add({
            stage: "S6",
            prompt: "gen.labels",
            mode: String(k + 1),
            target: { kind: "section", id: `s5#${k + 1}` },
            sections: [],
            deps: [],
            softDeps: [],
            topoOrder: 0,
            rank: 0,
            phase: 1,
            tail: 60 * n + unit("gen.labels"),
            out: GEN_ESTIMATE_PARAMS.outTargets.perLabel * n,
          }),
        );
      }

      const pages = [...pageOf.values()];
      const lastPhase = 1 + Math.max(1, ...pages.map((d) => d.phase));
      const final = add({
        stage: "S6o",
        prompt: "gen.overview",
        mode: "final",
        target: { kind: "overview", id: "final" },
        sections: ["s0", "s1", "s2"],
        deps: [...(early ? [early] : []), ...pages, ...labels].map(draftId),
        softDeps: [],
        topoOrder: 0,
        rank: 0,
        phase: lastPhase,
        tail: overviewTail(true) + Math.min(6000, 100 * eager.size) + Math.min(1500, 100 * pages.filter((d) => d.prompt === "gen.parent").length),
      });
      const seeds = ix.flowSeeds(8).length;
      const flows =
        seeds > 0
          ? add({
              stage: "S6o",
              prompt: "gen.flows",
              target: { kind: "section", id: "s3" },
              sections: ["s3"],
              deps: pages.filter((d) => d.prompt === "gen.module").map(draftId),
              softDeps: [],
              topoOrder: 0,
              rank: 0,
              phase: lastPhase,
              tail: 60 * seeds + Math.min(12000, 500 * seeds) + Math.min(4000, 100 * eager.size) + unit("gen.flows"),
            })
          : null;
      const maxTerms = Math.min(60, 4 * eager.size + 10);
      add({
        stage: "S6o",
        prompt: "gen.glossary",
        target: { kind: "section", id: "s12" },
        sections: ["s12"],
        deps: [...pages, final, ...(flows ? [flows] : [])].map(draftId),
        softDeps: [],
        topoOrder: 0,
        rank: 0,
        phase: lastPhase,
        tail: Math.min(4000, 200 * eager.size) + Math.min(1000, 40 * (s.repo.glossary?.length ?? 0)) + unit("gen.glossary"),
        out: GEN_ESTIMATE_PARAMS.outTargets.perTerm * maxTerms,
      });

      // scope: the scoped sections' tasks + their hard deps whose sections have no content yet
      let selected = drafts;
      const scope = req.scope ?? [];
      if (scope.length > 0) {
        const inScope = (d: Draft) => d.sections.some((sec) => scope.some((sc) => sec === sc || sec.startsWith(`${sc}/`)));
        const ids = new Map(drafts.map((d) => [draftId(d), d]));
        const keep = new Set(drafts.filter(inScope).map(draftId));
        const queue = [...keep];
        while (queue.length > 0) {
          const d = ids.get(queue.shift() as GenTaskId);
          for (const dep of d?.deps ?? []) {
            const dd = ids.get(dep);
            if (!dd || keep.has(dep) || dd.prompt === "gen.labels" || hasAiContent(dd.sections)) continue;
            keep.add(dep);
            queue.push(dep);
          }
        }
        selected = drafts.filter((d) => keep.has(draftId(d))).map((d) => ({ ...d, deps: d.deps.filter((x) => keep.has(x)) }));
      }

      // finalize: model / effort / lane, raw estimates in dispatch order (warm-first per fan-out group)
      const packTokens = Math.min(
        GEN_ESTIMATE_PARAMS.repoPackMaxTokens,
        ix.repoPack({ tokenizer: "claude-v5", maxTokens: GEN_ESTIMATE_PARAMS.repoPackMaxTokens }).tokens,
      );
      const tasks: PlannedTask[] = selected.map((d) => {
        const { model, effort } = modelOf(d.prompt, d.mode, engine, s);
        const t: PlannedTask = {
          id: draftId(d),
          stage: d.stage,
          prompt: d.prompt,
          target: d.target,
          sections: d.sections,
          deps: d.deps,
          softDeps: d.softDeps,
          model,
          effort,
          lane: "background",
          topoOrder: d.topoOrder,
          rank: d.rank,
          cacheKey: null,
          cached: false,
          estimate: {
            prefix: GEN_ESTIMATE_PARAMS.systemTokens + packTokens,
            tail: d.tail,
            out: d.out ?? 0,
            thinking: 0,
            cacheWrite: 0,
            cacheRead: 0,
            uncached: 0,
            apiUsd: 0,
            seconds: 0,
          },
          phase: d.phase,
        };
        if (d.mode !== undefined) t.mode = d.mode;
        return t;
      });
      const ordered2 = dispatchOrder(tasks);
      const seen = new Set<string>();
      for (const t of ordered2) {
        const g = groupOf(t);
        t.estimate = deps.estimator.task(t, engine, seen.has(g));
        seen.add(g);
      }
      const sections: SectionId[] = [];
      for (const t of ordered2) for (const sec of t.sections) if (!sections.includes(sec)) sections.push(sec);
      return {
        effort: req.effort,
        engine,
        scope,
        tasks: ordered2,
        sections,
        eager: eagerList.map((m) => m.id),
        lazy: leaves.filter((m) => !eager.has(m.id)).map((m) => m.id),
        indexDigest: ix.snapshot()?.indexDigest ?? "",
      };

      function draftId(d: Draft): GenTaskId {
        return planTaskId(deps.hasher, d.prompt, d.mode, d.target);
      }

      function overviewTail(isFinal: boolean): number {
        const facts = ix.facts();
        const readme = facts.find((f) => f.kind === "existing_doc" && f.role === "readme");
        const docs = readme ? Math.min(isFinal ? 6000 : 3000, ix.file(readme.path)?.tokensEst ?? 0) : 0;
        const graph = ix.graph("module");
        return (
          docs +
          Math.min(1500, 25 * facts.filter((f) => f.kind === "entry" || f.kind === "route" || f.kind === "cli").length) +
          Math.min(1500, 20 * graph.nodes.length + 15 * graph.edges.length) +
          unit("gen.overview") +
          (isFinal ? 200 : 0)
        );
      }
    },
  };
}

/** Topological order choosing the best ready task by the §3.4 key at every step (no boosts). */
export function dispatchOrder(tasks: readonly PlannedTask[]): PlannedTask[] {
  const ids = new Set(tasks.map((t) => t.id));
  const placed = new Set<string>();
  const left = [...tasks];
  const out: PlannedTask[] = [];
  while (left.length > 0) {
    const ready = left.filter((t) => t.deps.every((d) => placed.has(d) || !ids.has(d)));
    const pool = ready.length > 0 ? ready : left;
    const next = [...pool].sort(compareTasks)[0] as PlannedTask;
    left.splice(left.indexOf(next), 1);
    placed.add(next.id);
    out.push(next);
  }
  return out;
}
