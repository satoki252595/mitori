// Newcomer comprehension check (testing spec §7.3 (b), one cheap run): does a mitori document let someone who has never
// seen the repository answer what a newcomer and an expert need to know — compared with nothing and with the README?
//
//   1. writer (Sonnet, read-only Read/Grep/Glob in a sandbox copy without .git / .mitori) → n questions + gold answers
//      with evidence ranges; the automatic cut drops questions whose evidence is not in the checkout;
//   2. answerer (Haiku, no tools) once per condition: none (repo name only) / readme (README + docs/*.md) / mitori
//      (the generated document in reading order);
//   3. grader (Sonnet, no tools): gold answer + rubric + evidence lines + the answers under shuffled letters.
//
// Every call goes through the product's own lean claude-cli engine (agent spec I1–I14: no user settings, no MCP, no
// session, stdin prompt, system prompt file), on the subscription window only, under a hard API-equivalent cap.
//
//   MITORI_LIVE=1 scripts/nd bun eval/comprehension/run.ts --repo <clone> --doc <clone>/.mitori/doc --max-usd 0.8 --out <dir>
//   scripts/nd bun eval/comprehension/run.ts --repo <clone> --doc <dir> --dry-run      # materials and sizes only, no call
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Engine, EngineRequest, EngineResult } from "@mitori/agent";
import type { ModelId } from "@mitori/core";
import { assertBilling, BudgetGuard, EvalRefusal } from "../budget.ts";
import { estimateTokens, mitoriMaterial, readmeMaterial } from "./material.ts";
import {
  ANSWERS_SCHEMA,
  answerPrompt,
  answerSystem,
  COMPREHENSION_PROMPTS,
  type Condition,
  GRADES_SCHEMA,
  type GradeItem,
  graderPrompt,
  graderSystem,
  QUIZ_SCHEMA,
  writerPrompt,
  writerSystem,
} from "./prompts.ts";
import { type Answer, answersById, evidenceText, type Grade, type Question, type ScoreRow, scoreTable, shuffled, validateQuiz } from "./quiz.ts";

export const CONDITIONS: readonly Condition[] = ["none", "readme", "mitori"];

/** The structured output of a result, or the first JSON object in its text (a model that answered in prose). */
export function structuredOf(res: EngineResult | null): unknown {
  if (!res) return null;
  if (res.structured !== undefined) return res.structured;
  const text = res.text ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface ComprehensionOptions {
  engine: Engine;
  /** The repository (the writer's sandbox is copied from it; evidence is checked against it). */
  repo: string;
  /** Repository name shown to the answerer of the `none` condition. */
  name: string;
  /** The generated document (`<repo>/.mitori/doc`). */
  docDir: string;
  /** Number of questions. */
  n: number;
  /** API-equivalent cap for the whole check. */
  capUsd: number;
  /** The engine's empty sandbox cwd (`<home>/run/empty`) for the tool-less calls. */
  emptyCwd: string;
  /** Where the writer's read-only copy of the repository goes. */
  workDir: string;
  /** A stored quiz (`{questions}` as the writer returns it, e.g. an earlier report): no writer call. */
  quiz?: unknown;
  models?: { writer?: ModelId; answer?: ModelId; grader?: ModelId };
  seed?: number;
  log?: (msg: string) => void;
}

export interface CallRecord {
  role: "writer" | "answer" | "grader";
  condition?: Condition;
  model: ModelId;
  apiUsd: number;
  in: number;
  out: number;
  ms: number;
  stop: string;
}

export interface ComprehensionReport {
  v: "mitori.comprehension/1";
  repo: string;
  prompts: typeof COMPREHENSION_PROMPTS;
  models: { writer: ModelId; answer: ModelId; grader: ModelId };
  materials: Record<"readme" | "mitori", { tokens: number; files: number; truncated: boolean }>;
  questions: Question[];
  dropped: { id: string; reason: string }[];
  answers: Record<Condition, Answer[]>;
  grades: (Grade & { condition: Condition })[];
  scores: ScoreRow[];
  calls: CallRecord[];
  spentUsd: number;
  partial: boolean;
}

/** Run the check (see the file comment). Throws EvalRefusal when the engine does not bill the subscription window. */
export async function runComprehension(o: ComprehensionOptions): Promise<ComprehensionReport> {
  const log = o.log ?? (() => undefined);
  const models = {
    writer: o.models?.writer ?? ("claude-sonnet-5-5" as ModelId),
    answer: o.models?.answer ?? ("claude-haiku-4-5" as ModelId),
    grader: o.models?.grader ?? ("claude-sonnet-5-5" as ModelId),
  };
  const status = await o.engine.detect();
  assertBilling(status.billing);
  const guard = new BudgetGuard(o.capUsd);
  const calls: CallRecord[] = [];

  const run = async (role: CallRecord["role"], req: EngineRequest, estimateUsd: number, condition?: Condition): Promise<EngineResult | null> => {
    if (!guard.canStart(estimateUsd)) {
      log(`skip ${role}${condition ? `/${condition}` : ""}: the cap of $${o.capUsd} would be passed`);
      return null;
    }
    const r = o.engine.run(req, guard.signal);
    for await (const _ of r.events) {
      /* drained: only the result matters */
    }
    const res = await r.result;
    guard.add(res.usage.apiUsd);
    const u = res.usage;
    calls.push({
      role,
      ...(condition ? { condition } : {}),
      model: req.model,
      apiUsd: u.apiUsd,
      in: u.in + u.cacheRead + u.cacheWrite,
      out: u.out,
      ms: res.durationMs,
      stop: res.stop,
    });
    log(
      `${role}${condition ? `/${condition}` : ""}: ${res.stop}, $${u.apiUsd.toFixed(4)}, in ${u.in + u.cacheRead + u.cacheWrite}, out ${u.out}, ${(res.durationMs / 1000).toFixed(1)} s`,
    );
    if (res.stop !== "end") log(`  ${res.error?.code ?? ""} ${res.error?.message ?? ""}`);
    return res;
  };
  const base = (): Pick<EngineRequest, "keepAlive" | "persistSession" | "writeScope"> => ({ keepAlive: false, persistSession: false, writeScope: [] });

  // 1. questions: a stored quiz (written once per checkout, testing spec §7.3) or the writer, which reads a copy of
  //    the repository without .git / .mitori (it must not see the document)
  let rawQuiz: unknown = o.quiz ?? null;
  if (rawQuiz === null) {
    const sandbox = join(o.workDir, basename(o.repo).replace(/[^A-Za-z0-9._-]/g, "_"));
    rmSync(sandbox, { recursive: true, force: true });
    cpSync(o.repo, sandbox, { recursive: true, filter: (src) => !/\/\.(git|mitori)(\/|$)/.test(src.slice(o.repo.length)) });
    const writer = await run(
      "writer",
      {
        ...base(),
        ref: "comprehension:writer",
        mode: "agent",
        cwd: sandbox,
        model: models.writer,
        effort: "low",
        tools: "read_edit",
        system: writerSystem(sandbox),
        promptVer: COMPREHENSION_PROMPTS.writer,
        prompt: writerPrompt(o.name, o.n),
        contract: "agent/1",
        jsonSchema: QUIZ_SCHEMA,
        budget: { usd: Math.min(0.6, o.capUsd * 0.7), inTokens: 900_000, outTokens: 16_000, ms: 900_000 },
      },
      0.3,
    );
    rawQuiz = structuredOf(writer);
  }
  const quiz = validateQuiz(rawQuiz, o.repo);
  log(`questions: ${quiz.questions.length} kept, ${quiz.dropped.length} dropped${o.quiz ? " (stored quiz)" : ""}`);

  // 2. answers, one call per condition
  const readme = readmeMaterial(o.repo);
  const mitori = mitoriMaterial(o.docDir);
  const material: Record<Condition, string> = { none: "", readme: readme.text, mitori: mitori.text };
  const answers = {} as Record<Condition, Map<string, Answer>>;
  for (const c of CONDITIONS) {
    if (quiz.questions.length === 0) {
      answers[c] = answersById(null, []);
      continue;
    }
    const prompt = answerPrompt(c, o.name, material[c], quiz.questions);
    const res = await run(
      "answer",
      {
        ...base(),
        ref: `comprehension:answer:${c}`,
        mode: "generate",
        cwd: o.emptyCwd,
        model: models.answer,
        effort: "low",
        tools: "none",
        system: answerSystem(o.emptyCwd),
        promptVer: COMPREHENSION_PROMPTS.answer,
        prompt,
        contract: "answer/1",
        jsonSchema: ANSWERS_SCHEMA,
        budget: { usd: 0.2, inTokens: 120_000, outTokens: 8_000, ms: 300_000 },
      },
      (estimateTokens(prompt) * 1 + 3000 * 5) / 1e6,
      c,
    );
    answers[c] = answersById(structuredOf(res), quiz.questions);
  }

  // 3. grades: every answer of a question under a shuffled letter (seeded per question)
  const seed = o.seed ?? 20261003;
  const letters = ["A", "B", "C", "D", "E"];
  const labelOf = new Map<string, Condition>();
  const items: GradeItem[] = quiz.questions.map((q, i) => {
    const order = shuffled(CONDITIONS, seed + i);
    return {
      id: q.id,
      question: q.question,
      answerKey: q.answerKey,
      rubric: q.rubric,
      evidence: evidenceText(o.repo, q),
      answers: order.map((c, k) => {
        labelOf.set(`${q.id}:${letters[k]}`, c);
        return { label: letters[k] as string, answer: answers[c].get(q.id)?.answer ?? "不明" };
      }),
    };
  });
  const grades: (Grade & { condition: Condition })[] = [];
  if (items.length > 0) {
    const prompt = graderPrompt(items);
    const res = await run(
      "grader",
      {
        ...base(),
        ref: "comprehension:grader",
        mode: "generate",
        cwd: o.emptyCwd,
        model: models.grader,
        effort: "low",
        tools: "none",
        system: graderSystem(o.emptyCwd),
        promptVer: COMPREHENSION_PROMPTS.grader,
        prompt,
        contract: "answer/1",
        jsonSchema: GRADES_SCHEMA,
        budget: { usd: 0.25, inTokens: 120_000, outTokens: 12_000, ms: 300_000 },
      },
      (estimateTokens(prompt) * 3 + 4000 * 15) / 1e6,
    );
    const list = (structuredOf(res) as { grades?: Grade[] } | null)?.grades ?? [];
    for (const g of list) {
      const c = labelOf.get(`${g.id}:${g.label}`);
      if (c && (g.score === 0 || g.score === 0.5 || g.score === 1)) grades.push({ ...g, condition: c, hallucination: g.hallucination === true });
    }
  }

  const gradeOf = (qid: string, c: Condition) => grades.find((g) => g.id === qid && g.condition === c);
  const scores = scoreTable(quiz.questions, CONDITIONS, gradeOf, (qid, c) => answers[c].get(qid));
  return {
    v: "mitori.comprehension/1",
    repo: o.name,
    prompts: COMPREHENSION_PROMPTS,
    models,
    materials: {
      readme: { tokens: estimateTokens(readme.text), files: readme.files.length, truncated: readme.truncated },
      mitori: { tokens: estimateTokens(mitori.text), files: mitori.files.length, truncated: mitori.truncated },
    },
    questions: quiz.questions,
    dropped: quiz.dropped,
    answers: Object.fromEntries(CONDITIONS.map((c) => [c, [...answers[c].values()]])) as Record<Condition, Answer[]>,
    grades,
    scores,
    calls,
    spentUsd: guard.spentUsd,
    partial: guard.partial || grades.length < quiz.questions.length * CONDITIONS.length,
  };
}

/** Markdown summary of a report. */
export function reportMarkdown(r: ComprehensionReport): string {
  const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
  const lines = [
    `# Comprehension check — ${r.repo}`,
    "",
    `${r.questions.length} questions (${r.dropped.length} dropped) · writer ${r.models.writer} · answerer ${r.models.answer} · grader ${r.models.grader} · $${r.spentUsd.toFixed(3)} API-equivalent${r.partial ? " · PARTIAL" : ""}`,
    `Materials: README ${r.materials.readme.tokens} tok (${r.materials.readme.files} files) · mitori ${r.materials.mitori.tokens} tok (${r.materials.mitori.files} files${r.materials.mitori.truncated ? ", truncated" : ""})`,
    "",
    "| condition | score | newcomer | intermediate | expert | not in README | hallucination | 不明 |",
    "|---|---|---|---|---|---|---|---|",
    ...r.scores.map(
      (s) =>
        `| ${s.condition} | ${pct(s.mean)} | ${pct(s.byLevel.newcomer)} | ${pct(s.byLevel.intermediate)} | ${pct(s.byLevel.expert)} | ${pct(s.notReadmeAnswerable)} | ${pct(s.hallucinationRate)} | ${s.unknown} |`,
    ),
    "",
    "| id | level | category | question | none | readme | mitori |",
    "|---|---|---|---|---|---|---|",
    ...r.questions.map((q) => {
      const g = (c: Condition) => r.grades.find((x) => x.id === q.id && x.condition === c);
      const cell = (c: Condition) => `${g(c)?.score ?? "–"}${g(c)?.hallucination ? " ⚠" : ""}`;
      return `| ${q.id} | ${q.level} | ${q.category} | ${q.question.replace(/\|/g, "\\|")} | ${cell("none")} | ${cell("readme")} | ${cell("mitori")} |`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<number> {
  const { values: a } = parseArgs({
    options: {
      repo: { type: "string" },
      doc: { type: "string" },
      name: { type: "string" },
      n: { type: "string", default: "10" },
      "max-usd": { type: "string" },
      out: { type: "string" },
      quiz: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  // `--quiz <report.json | quiz.json>`: reuse questions written before (the quiz is written once per checkout)
  const quiz = a.quiz ? (JSON.parse(readFileSync(resolve(a.quiz), "utf8")) as unknown) : undefined;
  if (!a.repo) throw new EvalRefusal("--repo <dir> is required", 2);
  const repo = resolve(a.repo);
  const docDir = resolve(a.doc ?? join(repo, ".mitori/doc"));
  if (!existsSync(docDir)) throw new EvalRefusal(`no generated document at ${docDir}`, 2);
  if (a["dry-run"]) {
    const rd = readmeMaterial(repo);
    const md = mitoriMaterial(docDir);
    console.log(`readme: ${estimateTokens(rd.text)} tok, ${rd.files.length} files${rd.truncated ? " (truncated)" : ""}`);
    console.log(`mitori: ${estimateTokens(md.text)} tok, ${md.files.length} files${md.truncated ? " (truncated)" : ""}`);
    return 0;
  }
  const cap = Number(a["max-usd"]);
  if (process.env.MITORI_LIVE !== "1" || !(cap > 0)) throw new EvalRefusal("a live check needs MITORI_LIVE=1 and --max-usd <API-equivalent cap>", 2);
  const { startServerDaemon } = await import("../../apps/cli/src/daemon/server.ts");
  // the composition root canonicalizes its home (/var → /private/var on macOS): the empty sandbox cwd must match it
  const home = realpathSync(mkdtempSync(join(tmpdir(), "mitori-comp-")));
  const d = await startServerDaemon({ home, port: 0, version: "0.0.0", build: "test", overrides: {} });
  try {
    const engine = (d.handle as unknown as { engines: Record<string, Engine | null> }).engines["claude-cli"];
    if (!engine) throw new EvalRefusal("the claude-cli engine is not available", 2);
    const emptyCwd = join(home, "run/empty");
    mkdirSync(emptyCwd, { recursive: true });
    const report = await runComprehension({
      engine,
      repo,
      name: a.name ?? basename(repo),
      docDir,
      n: Number(a.n),
      capUsd: cap,
      emptyCwd,
      workDir: join(home, "sandbox"),
      ...(quiz !== undefined ? { quiz } : {}),
      log: (m) => console.error(`[comprehension] ${m}`),
    });
    const out = resolve(a.out ?? join(import.meta.dir, "../reports", `comprehension-${report.repo}`));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
    writeFileSync(join(out, "report.md"), reportMarkdown(report));
    console.log(reportMarkdown(report));
    return report.partial ? 1 : 0;
  } finally {
    await d.stop("comprehension").catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (err) {
    console.error(`comprehension: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = err instanceof EvalRefusal ? err.exit : 2;
  }
}
