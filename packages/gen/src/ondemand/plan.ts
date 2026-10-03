/**
 * Scoped plans (gen spec §11.3, §12): one section's prompt, a deep dive, doc.sync / doc.translate / doc.simplify
 * chunks, or the labels of new modules — always dep-free single-section tasks in the `doc` lane, so every task's
 * input renders at estimate time (exact tails, cache keys, `cached`). A section task has the id the planner gives
 * the same prompt and target (a lazy module page or any section can be scoped), without cross-section deps: a
 * scoped run reads whatever the doc holds now. Built directly (no whole-repo plan), so S9 stays O(changes).
 */
import type { Block, BlockId, DocLang, EffectiveSettings, EngineId, Hasher, ModuleId, SectionId } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { GEN_ESTIMATE_PARAMS, GEN_PROMPTS, type GenPlan, type GenPromptId, type PlannedTask } from "../contract.ts";
import { modelOf } from "../planner/params.ts";
import { engineOf, planTaskId } from "../planner/planner.ts";
import { LABELS_PER_CALL } from "../prompts/inputs.ts";
import { SYSTEM_TEMPLATES } from "../prompts/templates.ts";

/** What scoped planning reads. */
export interface ScopeEnv {
  /** Index. */
  indexer: Indexer;
  /** Doc. */
  doc: DocStore;
  /** Settings. */
  settings: () => EffectiveSettings;
  /** Hasher (task ids). */
  hasher: Hasher;
  /** Tokens of a text. */
  tokens: (text: string) => number;
}

/** doc.sync blocks per call (§11.3 R3, §12). */
export const SYNC_BLOCKS_PER_CALL = 8;
/** doc.translate chunk: ≤ 30 blocks and ≤ 6,000 characters (§12). */
export const TRANSLATE_CHUNK = { blocks: 30, chars: 6000 } as const;

/** Engine of an on-demand / S9 run: the settings default, except the session engine (it cannot run a push run). */
export function onDemandEngine(s: EffectiveSettings): EngineId {
  const e = engineOf({ effort: "standard" }, s);
  return e === "session" ? "claude-cli" : e;
}

/** Effort recorded on a scoped plan: the doc's last full effort (scoped runs never change it). */
export function docEffort(doc: Pick<DocStore, "manifest">): GenPlan["effort"] {
  return doc.manifest()?.effort ?? "standard";
}

/** A dep-free task for the doc lane. */
function task(
  env: ScopeEnv,
  engine: EngineId,
  t: Omit<PlannedTask, "id" | "model" | "effort" | "lane" | "cacheKey" | "cached" | "estimate" | "deps" | "softDeps" | "topoOrder" | "rank" | "phase"> & {
    tail: number;
    out?: number;
    prefix: number;
  },
): PlannedTask {
  const { model, effort } = modelOf(t.prompt, t.mode, engine, env.settings());
  const p: PlannedTask = {
    id: planTaskId(env.hasher, t.prompt, t.mode, t.target),
    stage: t.stage,
    prompt: t.prompt,
    target: t.target,
    sections: t.sections,
    deps: [],
    softDeps: [],
    model,
    effort,
    lane: "doc",
    topoOrder: 0,
    rank: 0,
    cacheKey: null,
    cached: false,
    estimate: { prefix: t.prefix, tail: t.tail, out: t.out ?? 0, thinking: 0, cacheWrite: 0, cacheRead: 0, uncached: 0, apiUsd: 0, seconds: 0 },
    phase: 1,
  };
  if (t.mode !== undefined) p.mode = t.mode;
  return p;
}

/** Plan around tasks (effort = the doc's, scope = the sections written). */
export function scopedPlan(env: ScopeEnv, engine: EngineId, tasks: PlannedTask[]): GenPlan {
  const sections: SectionId[] = [];
  for (const t of tasks) for (const s of t.sections) if (!sections.includes(s)) sections.push(s);
  return {
    effort: docEffort(env.doc),
    engine,
    scope: sections,
    tasks,
    sections,
    eager: [],
    lazy: [],
    indexDigest: env.indexer.snapshot()?.indexDigest ?? "",
  };
}

/** Prefix tokens of a gen.system task (system prompt + repo pack). */
function genPrefix(env: ScopeEnv): number {
  const pack = env.indexer.repoPack({ tokenizer: "claude-v5", maxTokens: GEN_ESTIMATE_PARAMS.repoPackMaxTokens }).tokens;
  return GEN_ESTIMATE_PARAMS.systemTokens + Math.min(GEN_ESTIMATE_PARAMS.repoPackMaxTokens, pack);
}

/** Section prompt per top section (module pages are resolved through the doc index). */
const SECTION_PROMPT: Partial<
  Record<string, Extract<GenPromptId, "gen.flows" | "gen.datamodel" | "gen.quality" | "gen.decisions" | "gen.risks" | "gen.glossary" | "gen.questions">>
> = {
  s3: "gen.flows",
  s7: "gen.datamodel",
  s9: "gen.quality",
  s10: "gen.decisions",
  s11: "gen.risks",
  s12: "gen.glossary",
  s13: "gen.questions",
};

/**
 * The task that (re)generates one section: `s6/<slug>` ⇒ gen.module / gen.parent, `s0`–`s2` ⇒ the final overview,
 * `s3` ⇒ gen.flows (with flow seeds), `s7` ⇒ gen.datamodel (with schema facts), `s9`…`s13` ⇒ their section prompt.
 * Empty when no prompt writes the section (static sections, a module that is gone).
 */
export function sectionTasks(env: ScopeEnv, engine: EngineId, section: SectionId): PlannedTask[] {
  const ix = env.indexer;
  const entry = env.doc.index().modules.find((e) => e.section === section);
  if (entry) {
    const m = ix.module(entry.id);
    if (!m) return [];
    const leaf = m.children.length === 0;
    const t = task(env, engine, {
      stage: leaf ? "S5" : "S6",
      prompt: leaf ? "gen.module" : "gen.parent",
      target: { kind: leaf ? "module" : "parent", id: m.id },
      sections: [section],
      prefix: genPrefix(env),
      tail: 0,
    });
    return [{ ...t, topoOrder: m.topoOrder, rank: m.rank }];
  }
  const top = section.split("/")[0] as string;
  if (top === "s0" || top === "s1" || top === "s2")
    return [
      task(env, engine, {
        stage: "S6o",
        prompt: "gen.overview",
        mode: "final",
        target: { kind: "overview", id: "final" },
        sections: ["s0", "s1", "s2"],
        prefix: genPrefix(env),
        tail: 0,
      }),
    ];
  const prompt = SECTION_PROMPT[top];
  if (!prompt) return [];
  if (prompt === "gen.flows" && ix.flowSeeds(8).length === 0) return [];
  if (prompt === "gen.datamodel" && ix.facts("schema").length === 0) return [];
  const pages = env.doc.index().modules.filter((e) => (env.doc.section(e.section)?.blocks ?? []).some((b) => b.origin === "ai")).length;
  const out =
    prompt === "gen.glossary"
      ? GEN_ESTIMATE_PARAMS.outTargets.perTerm * Math.min(60, 4 * pages + 10)
      : prompt === "gen.questions"
        ? GEN_ESTIMATE_PARAMS.outTargets.questions
        : 0;
  return [
    task(env, engine, {
      stage: GEN_PROMPTS[prompt].stage,
      prompt,
      target: { kind: "section", id: top },
      sections: [top as SectionId],
      prefix: genPrefix(env),
      tail: 0,
      out,
    }),
  ];
}

/** gen.labels for the given modules only (the labels input lists the modules a plan does not page, §5.2). */
export function labelsPlan(env: ScopeEnv, engine: EngineId, modules: readonly ModuleId[]): GenPlan {
  const ids = new Set<string>(modules);
  const all = env.indexer.modules().map((m) => m.id);
  const n = Math.min(LABELS_PER_CALL, modules.length);
  const t = task(env, engine, {
    stage: "S6",
    prompt: "gen.labels",
    mode: "1",
    target: { kind: "section", id: "s5#1" },
    sections: ["s5"],
    prefix: GEN_ESTIMATE_PARAMS.systemTokens,
    tail: 60 * n,
    out: GEN_ESTIMATE_PARAMS.outTargets.perLabel * n,
  });
  return { ...scopedPlan(env, engine, [t]), eager: all.filter((id) => !ids.has(id)) };
}

/** gen.deepdive (topic mode) replacing a deep-dive placeholder block of a module page (§12). */
export function deepdiveTask(env: ScopeEnv, engine: EngineId, block: Block): PlannedTask {
  return task(env, engine, {
    stage: "S8",
    prompt: "gen.deepdive",
    mode: "topic",
    target: { kind: "block", id: block.id },
    sections: [block.section],
    prefix: GEN_ESTIMATE_PARAMS.systemTokens,
    tail: 4000,
  });
}

/** Prefix tokens of a doc.* task: the small doc.system prompt (no repo pack). */
function docPrefix(env: ScopeEnv): number {
  return env.tokens(SYSTEM_TEMPLATES["doc.system"]);
}

/** Marker-form text length of a block. */
function chars(env: ScopeEnv, b: Block): number {
  return (env.doc.markerForm(b.id) ?? b.md).length;
}

/** doc.* tasks over `blocks` in chunks (`max` blocks, optional char cap), one task per chunk. */
function chunked(
  env: ScopeEnv,
  engine: EngineId,
  prompt: Extract<GenPromptId, "doc.sync" | "doc.translate" | "doc.simplify">,
  blocks: readonly Block[],
  cap: { blocks: number; chars?: number },
  mode?: string,
): PlannedTask[] {
  const prefix = docPrefix(env);
  const out: PlannedTask[] = [];
  let cur: Block[] = [];
  let size = 0;
  const flush = () => {
    if (cur.length === 0) return;
    const sections: SectionId[] = [];
    for (const b of cur) if (!sections.includes(b.section)) sections.push(b.section);
    const tail = cur.reduce((n, b) => n + env.tokens(env.doc.markerForm(b.id) ?? b.md) + 30 + 8 * b.claims.length, 0) * (prompt === "doc.sync" ? 3 : 1);
    const spec = { stage: GEN_PROMPTS[prompt].stage, prompt, target: { kind: "block" as const, id: cur.map((b) => b.id).join(",") }, sections, prefix, tail };
    out.push(task(env, engine, mode === undefined ? spec : { ...spec, mode }));
    cur = [];
    size = 0;
  };
  for (const b of blocks) {
    const n = chars(env, b);
    if (cur.length >= cap.blocks || (cap.chars !== undefined && cur.length > 0 && size + n > cap.chars)) flush();
    cur.push(b);
    size += n;
  }
  flush();
  return out;
}

/** doc.sync over blocks with stale claims, 8 per call. */
export function syncTasks(env: ScopeEnv, engine: EngineId, blocks: readonly Block[]): PlannedTask[] {
  return chunked(env, engine, "doc.sync", blocks, { blocks: SYNC_BLOCKS_PER_CALL });
}

/** doc.translate into `lang`, ≤ 30 blocks / 6,000 characters per call. */
export function translateTasks(env: ScopeEnv, engine: EngineId, blocks: readonly Block[], lang: DocLang): PlannedTask[] {
  return chunked(env, engine, "doc.translate", blocks, TRANSLATE_CHUNK, lang);
}

/** doc.simplify of one block (level newcomer). */
export function simplifyTask(env: ScopeEnv, engine: EngineId, block: Block): PlannedTask[] {
  return chunked(env, engine, "doc.simplify", [block], { blocks: 1 }, "newcomer");
}

/** True when a block carries generated or human text a rewrite prompt can work on. */
export function textBlock(b: Pick<Block, "origin" | "kind" | "status">): boolean {
  return b.origin !== "static" && b.status !== "placeholder" && !["heading", "facts", "code", "diagram", "placeholder"].includes(b.kind);
}

/** The ids of blocks, in order. */
export const idsOf = (blocks: readonly Pick<Block, "id">[]): BlockId[] => blocks.map((b) => b.id);
