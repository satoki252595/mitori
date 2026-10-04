/**
 * Open questions (§13, gen spec §5.6.10): every gen.* task may emit `question` lines; they are collected from the
 * run's finished outputs and the outputs behind current AI content (RAW), de-duplicated by normalized text and
 * ordered by section and generation order. Up to
 * `questionsLlmAbove` (15) the list is written as is (0 tokens); above it `gen.questions` consolidates it first.
 * The list replaces the AI question blocks of `s13`; blocks whose text is unchanged are kept (same ids, no write).
 * CR-PENDING(WP-06b): `DocStore.setQuestions` (CR m1-18) does not exist; the list is written as `question` blocks
 * through `applyGenerated` (cr-requests/WP-06b.md R2).
 */
import {
  type BlockId,
  DOC_TEMPLATE,
  type DocLang,
  type EngineId,
  type GenRunId,
  type ModelId,
  type PromptVersion,
  type SectionId,
  type Xxh3,
} from "@mitori/core";
import type { ApplyOptions, DocStore, GeneratedBlock } from "@mitori/doc";
import type { GenLine, GenQuestionLine } from "../contract.ts";
import type { GenStore, TaskRow } from "./store.ts";

const FINISHED = new Set(["done", "cached"]);

/** Section order key: the top section's position in the template, then the sub-section id. */
function sectionKey(s: SectionId): string {
  const top = s.split("/")[0] as string;
  const i = DOC_TEMPLATE.findIndex((t) => t.id === top);
  return `${String(i < 0 ? 99 : i).padStart(2, "0")}|${s}`;
}

const norm = (t: string) => t.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * RAW questions of finished tasks, including skipped scoped dependencies whose output produced current AI blocks.
 * Current-run producers take precedence; obsolete or unrelated outputs are not read.
 */
export function questionsOf(
  store: Pick<GenStore, "getOutput" | "tasks" | "getRun">,
  rows: readonly TaskRow[],
  doc: Pick<DocStore, "index">,
): GenQuestionLine[] {
  const blocks = Object.values(doc.index().blocks).filter((b) => b.origin === "ai" && b.gen?.run && !b.gen.promptVer.startsWith("gen.questions@"));
  const current = new Map(blocks.map((b) => [b.id, b]));
  const sources = new Map<string, { row: TaskRow; at: number }>();
  const producer = (r: TaskRow) => JSON.stringify([r.plan.prompt, r.plan.mode, r.plan.target]);
  for (const run of new Set(blocks.map((b) => b.gen?.run as GenRunId))) {
    const at = Date.parse(store.getRun(run)?.run.startedAt ?? "") || 0;
    for (const r of store.tasks(run)) {
      if (!FINISHED.has(r.task.state) || !r.task.cacheKey || r.plan.prompt === "gen.questions") continue;
      if (!r.task.blocks.some((id) => current.get(id)?.gen?.run === run && current.get(id)?.gen?.promptVer.startsWith(`${r.plan.prompt}@`))) continue;
      const key = producer(r);
      if (!sources.has(key) || at > (sources.get(key)?.at ?? 0)) sources.set(key, { row: r, at });
    }
  }
  for (const r of rows)
    if (FINISHED.has(r.task.state) && r.task.cacheKey && r.plan.prompt !== "gen.questions") sources.set(producer(r), { row: r, at: Infinity });
  const seen = new Set<string>();
  const out: { q: GenQuestionLine & { section: SectionId }; order: number }[] = [];
  let order = 0;
  const done = [...sources.values()].map(({ row }) => row).sort((a, b) => a.plan.topoOrder - b.plan.topoOrder || (a.task.id < b.task.id ? -1 : 1));
  for (const r of done) {
    for (const l of store.getOutput(r.task.cacheKey)?.lines ?? []) {
      const line = JSON.parse(l) as GenLine;
      if (line.t !== "question") continue;
      const key = norm(line.text);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      const q: GenQuestionLine & { section: SectionId } = { t: "question", section: line.section ?? r.plan.sections[0] ?? "s13", text: line.text };
      if (line.cites && line.cites.length > 0) q.cites = line.cites;
      out.push({ q, order: order++ });
    }
  }
  return out
    .sort((a, b) => {
      const ka = sectionKey(a.q.section);
      const kb = sectionKey(b.q.section);
      return ka < kb ? -1 : ka > kb ? 1 : a.order - b.order;
    })
    .map((x) => x.q);
}

/** Provenance of the written list. */
export interface QuestionWriteCtx {
  /** Run. */
  run: GenRunId;
  /** Doc language. */
  lang: DocLang;
  /** Engine. */
  engine: EngineId;
  /** Model of the task. */
  model: ModelId;
  /** Prompt version. */
  promptVer: PromptVersion;
  /** Snapshot. */
  indexDigest: Xxh3;
  /** Write or propose (incremental runs). */
  mode: ApplyOptions["mode"];
}

/** Markdown of one question: the section it is about in bold (when not s13 itself), the text, cited ranges as code. */
export function questionMd(doc: Pick<DocStore, "section">, q: GenQuestionLine, lang: DocLang): string {
  const title = q.section && q.section !== "s13" ? doc.section(q.section)?.node.title : undefined;
  const sep = lang === "ja" ? "：" : ": ";
  const refs = (q.cites ?? []).map((c) => ` \`${c.path}:${c.start}-${c.end}\``).join("");
  return `${title ? `**${title}**${sep}` : ""}${q.text.trim()}${refs}`;
}

/**
 * Replace the AI question blocks of s13 with `list` (locked and human blocks stay; an unchanged text keeps its block;
 * an empty list changes nothing). Returns the blocks written (empty when the list is unchanged).
 */
export async function writeQuestions(
  env: { doc: DocStore; write: <T>(label: string, fn: () => T) => Promise<T> },
  list: readonly GenQuestionLine[],
  ctx: QuestionWriteCtx,
): Promise<BlockId[]> {
  const doc = env.doc;
  // No newly extracted question is not evidence that existing questions have been resolved.
  if (list.length === 0) return [];
  const current = (doc.section("s13")?.blocks ?? []).filter((b) => b.origin === "ai" && b.kind === "question" && !b.lock);
  const byMd = new Map(current.map((b) => [doc.markerForm(b.id) ?? b.md, b.id]));
  const keep = new Set<BlockId>();
  const blocks: GeneratedBlock[] = [];
  for (const q of list) {
    const md = questionMd(doc, q, ctx.lang);
    const hit = byMd.get(md);
    if (hit !== undefined && !keep.has(hit)) {
      keep.add(hit);
      continue;
    }
    blocks.push({
      id: null,
      section: "s13",
      kind: "question",
      depth: "L3",
      audience: ["reviewer", "dev"],
      lang: ctx.lang,
      md,
      claims: [],
      gen: { model: ctx.model, engine: ctx.engine, stage: "S6o", promptVer: ctx.promptVer, indexDigest: ctx.indexDigest, run: ctx.run },
    });
  }
  const deletes = current.filter((b) => !keep.has(b.id)).map((b) => b.id);
  if (blocks.length === 0 && deletes.length === 0) return [];
  const res = await env.write("gen.questions", () =>
    doc.applyGenerated(blocks, { mode: ctx.mode, deletes, source: { kind: "regen", id: ctx.run }, reason: `open questions (${ctx.promptVer})`, listed: 0 }),
  );
  return res.written;
}
