// Quiz validation (testing spec §7.3 step 3, the automatic cut), answer / grade parsing and the score table.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES, type Category, type Condition, type Level } from "./prompts.ts";

export interface Evidence {
  path: string;
  start: number;
  end: number;
}

export interface Question {
  id: string;
  level: Level;
  category: Category;
  question: string;
  answerKey: string;
  rubric: { full: string; partial: string };
  evidence: Evidence[];
  readmeAnswerable: boolean;
}

export interface Answer {
  id: string;
  answer: string;
  confidence: number;
  basis: "material" | "prior" | "unknown";
}

export interface Grade {
  id: string;
  label: string;
  score: 0 | 0.5 | 1;
  hallucination: boolean;
  reason: string;
}

const LEVELS: ReadonlySet<string> = new Set(["newcomer", "intermediate", "expert"]);
const CATS: ReadonlySet<string> = new Set(CATEGORIES);
const ANSWER_KEY_MAX = 400;
const EVIDENCE_MAX_LINES = 60;

/** Lines of a repo file (null when it does not exist). */
function fileLines(repo: string, path: string): string[] | null {
  const abs = join(repo, path);
  if (path.includes("..") || !existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8").split("\n");
  } catch {
    return null;
  }
}

/**
 * Keep the questions that pass the automatic cut: known level / category, a non-empty question and answer key ≤ 400
 * characters, and every evidence range inside its file (L0). Ids are renumbered q01… in order. Returns the kept
 * questions and why the others were dropped.
 */
export function validateQuiz(raw: unknown, repo: string): { questions: Question[]; dropped: { id: string; reason: string }[] } {
  const list = (raw as { questions?: unknown })?.questions;
  const questions: Question[] = [];
  const dropped: { id: string; reason: string }[] = [];
  if (!Array.isArray(list)) return { questions, dropped: [{ id: "-", reason: "no questions array" }] };
  for (const [i, q] of list.entries()) {
    const id = typeof q?.id === "string" ? q.id : `#${i + 1}`;
    const drop = (reason: string) => dropped.push({ id, reason });
    if (typeof q !== "object" || q === null) {
      drop("not an object");
      continue;
    }
    if (!LEVELS.has(q.level)) {
      drop(`level ${String(q.level)}`);
      continue;
    }
    if (!CATS.has(q.category)) {
      drop(`category ${String(q.category)}`);
      continue;
    }
    if (typeof q.question !== "string" || q.question.trim() === "" || typeof q.answerKey !== "string" || q.answerKey.trim() === "") {
      drop("empty question or answer key");
      continue;
    }
    if ([...q.answerKey].length > ANSWER_KEY_MAX) {
      drop("answer key over 400 characters");
      continue;
    }
    const ev: Evidence[] = Array.isArray(q.evidence) ? q.evidence : [];
    const bad = ev.find((e) => {
      const lines = typeof e?.path === "string" ? fileLines(repo, e.path) : null;
      return !lines || !(Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 1 && e.start <= e.end && e.end <= lines.length);
    });
    if (ev.length === 0 || bad) {
      drop(ev.length === 0 ? "no evidence" : `evidence ${bad?.path}:${bad?.start}-${bad?.end} is not in the checkout`);
      continue;
    }
    questions.push({
      id: `q${String(questions.length + 1).padStart(2, "0")}`,
      level: q.level,
      category: q.category,
      question: q.question.trim(),
      answerKey: q.answerKey.trim(),
      rubric: { full: String(q.rubric?.full ?? ""), partial: String(q.rubric?.partial ?? "") },
      evidence: ev.map((e) => ({ path: e.path, start: e.start, end: e.end })),
      readmeAnswerable: q.readmeAnswerable === true,
    });
  }
  return { questions, dropped };
}

/** The evidence lines of a question (numbered, ±3 lines, each range capped) for the grader. */
export function evidenceText(repo: string, q: Question): string {
  const out: string[] = [];
  for (const e of q.evidence) {
    const lines = fileLines(repo, e.path) ?? [];
    const from = Math.max(1, e.start - 3);
    const to = Math.min(lines.length, e.end + 3, from + EVIDENCE_MAX_LINES - 1);
    out.push(`--- ${e.path}:${e.start}-${e.end}`);
    for (let n = from; n <= to; n++) out.push(`${n}| ${lines[n - 1] ?? ""}`);
  }
  return out.join("\n");
}

/** The answers of one condition, by question id (missing ids answer "不明"). */
export function answersById(raw: unknown, questions: readonly Question[]): Map<string, Answer> {
  const list = (raw as { answers?: unknown })?.answers;
  const out = new Map<string, Answer>();
  if (Array.isArray(list))
    for (const a of list)
      if (typeof a?.id === "string" && typeof a.answer === "string")
        out.set(a.id, {
          id: a.id,
          answer: a.answer,
          confidence: Number(a.confidence) || 0,
          basis: a.basis === "material" || a.basis === "prior" ? a.basis : "unknown",
        });
  for (const q of questions) if (!out.has(q.id)) out.set(q.id, { id: q.id, answer: "不明", confidence: 0, basis: "unknown" });
  return out;
}

/** Deterministic shuffle (mulberry32) — the condition behind each answer letter is hidden from the grader. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export interface ScoreRow {
  condition: Condition;
  mean: number;
  hallucinationRate: number;
  byLevel: Record<Level, number | null>;
  notReadmeAnswerable: number | null;
  unknown: number;
}

/** Score table per condition (missing grades count 0). */
export function scoreTable(
  questions: readonly Question[],
  conditions: readonly Condition[],
  grade: (qid: string, c: Condition) => Grade | undefined,
  answer: (qid: string, c: Condition) => Answer | undefined,
): ScoreRow[] {
  const mean = (xs: number[]) => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000);
  return conditions.map((c) => {
    const scores = questions.map((q) => grade(q.id, c)?.score ?? 0);
    const byLevel = {} as Record<Level, number | null>;
    for (const l of ["newcomer", "intermediate", "expert"] as const)
      byLevel[l] = mean(questions.filter((q) => q.level === l).map((q) => grade(q.id, c)?.score ?? 0));
    return {
      condition: c,
      mean: mean(scores) ?? 0,
      hallucinationRate: mean(questions.map((q) => (grade(q.id, c)?.hallucination ? 1 : 0))) ?? 0,
      byLevel,
      notReadmeAnswerable: mean(questions.filter((q) => !q.readmeAnswerable).map((q) => grade(q.id, c)?.score ?? 0)),
      unknown: questions.filter((q) => (answer(q.id, c)?.basis ?? "unknown") === "unknown").length,
    };
  });
}
