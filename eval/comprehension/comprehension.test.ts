// The comprehension check on a scripted engine: no process, no tokens.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Engine, EngineRequest, EngineResult } from "@mitori/agent";
import { PRICING_VERSION } from "@mitori/core";
import { EvalRefusal } from "../budget.ts";
import { compactDoc, mitoriMaterial, readmeMaterial } from "./material.ts";
import { levelMix } from "./prompts.ts";
import { evidenceText, shuffled, validateQuiz } from "./quiz.ts";
import { reportMarkdown, runComprehension, structuredOf } from "./run.ts";

function fixtureRepo(): { repo: string; doc: string; cleanup: () => void } {
  const repo = mkdtempSync(join(tmpdir(), "mitori-comp-test-"));
  writeFileSync(join(repo, "README.md"), "# Tsundoku\n\nKeeps a reading list.\n");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src/store.ts"), "export class Store {\n  get(id: string) {\n    return null;\n  }\n}\n");
  mkdirSync(join(repo, ".mitori/doc/modules"), { recursive: true });
  writeFileSync(
    join(repo, ".mitori/doc/00-tldr.md"),
    "# 0. ひとことで <!-- b_aaaaaaaa -->\n\n読書リスト（[README.md:3](../../README.md#L3)）。 <!-- b_bbbbbbbb -->\n",
  );
  writeFileSync(join(repo, ".mitori/doc/06-modules.md"), "# 6. モジュール詳細\n\n| [ストア](modules/store.md) |\n");
  writeFileSync(join(repo, ".mitori/doc/modules/store.md"), "# ストア\n\n`Store.get` は null を返す（[store.ts:2-4](../../../src/store.ts#L2-L4)）。\n");
  writeFileSync(join(repo, ".mitori/doc/99-appendix.md"), "# 付録\n");
  return { repo, doc: join(repo, ".mitori/doc"), cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

const QUIZ = {
  questions: [
    {
      id: "a",
      level: "newcomer",
      category: "purpose",
      question: "何のためのリポジトリか",
      answerKey: "読書リストを管理する",
      rubric: { full: "読書リスト", partial: "リスト" },
      evidence: [{ path: "README.md", start: 3, end: 3 }],
      readmeAnswerable: true,
    },
    {
      id: "b",
      level: "expert",
      category: "error_handling",
      question: "Store.get は見つからないとき何を返すか",
      answerKey: "null",
      rubric: { full: "null", partial: "-" },
      evidence: [{ path: "src/store.ts", start: 2, end: 4 }],
      readmeAnswerable: false,
    },
    {
      id: "c",
      level: "expert",
      category: "invariant",
      question: "x",
      answerKey: "y",
      rubric: { full: "", partial: "" },
      evidence: [{ path: "nope.ts", start: 1, end: 1 }],
      readmeAnswerable: false,
    },
  ],
};

/** A scripted engine: the writer returns QUIZ, answerers answer from their material, the grader scores by content. */
function scriptedEngine(billing: "subscription-window" | "overage" = "subscription-window"): Engine & { requests: EngineRequest[] } {
  const requests: EngineRequest[] = [];
  const result = (structured: unknown, apiUsd = 0.01): EngineResult => ({
    stop: "end",
    usage: { in: 100, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 50, apiUsd, pricingVer: PRICING_VERSION },
    usageEstimated: false,
    structured,
    denials: [],
    auth: "subscription",
    durationMs: 5,
  });
  return {
    id: "claude-cli",
    requests,
    async detect() {
      return { engine: "claude-cli", installed: true, auth: "subscription", capabilities: [], billing, problems: [], checkedAt: "2026-10-04T00:00:00.000Z" };
    },
    run(req) {
      requests.push(req);
      let structured: unknown;
      if (req.mode === "agent") structured = QUIZ;
      else if (req.ref.startsWith("comprehension:answer:")) {
        const c = req.ref.split(":")[2];
        structured = {
          answers: [
            { id: "q01", answer: c === "none" ? "不明" : "読書リストを管理する", confidence: 0.9, basis: c === "none" ? "unknown" : "material" },
            { id: "q02", answer: c === "mitori" ? "null を返す" : "例外を投げる", confidence: 0.5, basis: c === "mitori" ? "material" : "prior" },
          ],
        };
      } else {
        // grader: full credit when the answer contains the key word; the invented exception is a hallucination
        const grades: unknown[] = [];
        for (const block of req.prompt.split("=== ").slice(1)) {
          const id = block.slice(0, 3);
          for (const m of block.matchAll(/ANSWER ([A-E]): (.*)/g)) {
            const text = m[2] as string;
            const ok = text.includes("読書リスト") || text.includes("null");
            grades.push({ id, label: m[1], score: ok ? 1 : 0, hallucination: text.includes("例外"), reason: "-" });
          }
        }
        structured = { grades };
      }
      const res = Promise.resolve(result(structured));
      return { events: (async function* () {})(), result: res, stop() {} };
    },
  };
}

describe("EVAL-COMP-01 comprehension check on a scripted engine", () => {
  test("writer → automatic cut → three answerers → blind grading → score table; lean requests only", async () => {
    const f = fixtureRepo();
    const work = mkdtempSync(join(tmpdir(), "mitori-comp-work-"));
    try {
      const engine = scriptedEngine();
      const report = await runComprehension({
        engine,
        repo: f.repo,
        name: "tsundoku",
        docDir: f.doc,
        n: 3,
        capUsd: 0.5,
        emptyCwd: "/nonexistent/empty",
        workDir: work,
      });
      expect(report.questions.map((q) => q.id)).toEqual(["q01", "q02"]);
      expect(report.dropped).toEqual([{ id: "c", reason: "evidence nope.ts:1-1 is not in the checkout" }]);
      const by = Object.fromEntries(report.scores.map((s) => [s.condition, s]));
      expect([by.none?.mean, by.readme?.mean, by.mitori?.mean]).toEqual([0, 0.5, 1]);
      expect(by.readme?.hallucinationRate).toBe(0.5);
      expect(by.mitori?.notReadmeAnswerable).toBe(1);
      expect(report.spentUsd).toBeCloseTo(0.05, 6);
      expect(report.partial).toBe(false);
      // the writer reads a sandbox copy without the document; the others run without tools in the empty cwd
      const [writer, ...rest] = engine.requests;
      expect(writer).toMatchObject({ mode: "agent", tools: "read_edit", writeScope: [], persistSession: false, model: "claude-sonnet-5-5" });
      expect(writer?.system).toContain(`Working directory: ${writer?.cwd}`);
      expect(rest.every((r) => r.mode === "generate" && r.tools === "none" && r.cwd === "/nonexistent/empty" && r.jsonSchema !== undefined)).toBe(true);
      expect(rest.slice(0, 3).map((r) => r.model)).toEqual(["claude-haiku-4-5", "claude-haiku-4-5", "claude-haiku-4-5"]);
      // the answerer of `mitori` sees the compacted document, `none` sees nothing, the grader never sees condition names
      expect(rest[2]?.prompt).toContain("`Store.get` は null を返す（store.ts:2-4）");
      expect(rest[0]?.prompt).not.toContain("<<<MATERIAL>>>");
      expect(rest[3]?.prompt).not.toMatch(/mitori|\bnone\b|condition/i);
      expect(rest[3]?.prompt).toContain("ANSWER A: ");
      expect(reportMarkdown(report)).toContain("| mitori | 100% |");
    } finally {
      f.cleanup();
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("a metered engine starts nothing; the cap stops calls that would pass it", async () => {
    const f = fixtureRepo();
    const work = mkdtempSync(join(tmpdir(), "mitori-comp-work-"));
    try {
      const metered = scriptedEngine("overage");
      await expect(
        runComprehension({ engine: metered, repo: f.repo, name: "t", docDir: f.doc, n: 3, capUsd: 1, emptyCwd: "/x", workDir: work }),
      ).rejects.toBeInstanceOf(EvalRefusal);
      expect(metered.requests).toEqual([]);
      const capped = scriptedEngine();
      const r = await runComprehension({ engine: capped, repo: f.repo, name: "t", docDir: f.doc, n: 3, capUsd: 0.2, emptyCwd: "/x", workDir: work });
      expect(capped.requests.length).toBeLessThan(5);
      expect(r.partial).toBe(true);
    } finally {
      f.cleanup();
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("a stored quiz (an earlier report) skips the writer: the questions are written once per checkout", async () => {
    const f = fixtureRepo();
    const work = mkdtempSync(join(tmpdir(), "mitori-comp-work-"));
    try {
      const first = await runComprehension({
        engine: scriptedEngine(),
        repo: f.repo,
        name: "t",
        docDir: f.doc,
        n: 3,
        capUsd: 0.5,
        emptyCwd: "/x",
        workDir: work,
      });
      const engine = scriptedEngine();
      const again = await runComprehension({ engine, repo: f.repo, name: "t", docDir: f.doc, n: 3, capUsd: 0.5, emptyCwd: "/x", workDir: work, quiz: first });
      expect(engine.requests.some((r) => r.mode === "agent")).toBe(false);
      expect(again.questions).toEqual(first.questions);
      expect(again.scores).toEqual(first.scores);
    } finally {
      f.cleanup();
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("EVAL-COMP-02 materials, quiz cut, helpers", () => {
  test("mitori material: chapters in order, module pages after the index, no appendix, ids and link targets dropped", () => {
    const f = fixtureRepo();
    try {
      const m = mitoriMaterial(f.doc);
      expect(m.files).toEqual(["00-tldr.md", "06-modules.md", "modules/store.md"]);
      expect(m.text).not.toContain("b_aaaaaaaa");
      expect(m.text).toContain("読書リスト（README.md:3）。");
      expect(readmeMaterial(f.repo).files).toEqual(["README.md"]);
      expect(compactDoc("x（[a.ts:1](../../a.ts#L1)）。 <!-- b_abcdefgh -->")).toBe("x（a.ts:1）。");
    } finally {
      f.cleanup();
    }
  });

  test("the cut drops unknown levels, long keys and evidence outside the checkout; evidence lines are numbered", () => {
    const f = fixtureRepo();
    try {
      const long = { ...QUIZ.questions[0], answerKey: "あ".repeat(401) };
      const bad = { ...QUIZ.questions[0], level: "guru" };
      const v = validateQuiz({ questions: [QUIZ.questions[1], long, bad] }, f.repo);
      expect(v.questions.map((q) => q.question)).toEqual(["Store.get は見つからないとき何を返すか"]);
      expect(v.dropped.map((d) => d.reason)).toEqual(["answer key over 400 characters", "level guru"]);
      expect(evidenceText(f.repo, v.questions[0] as never)).toContain("3|     return null;");
      expect(validateQuiz(null, f.repo).questions).toEqual([]);
    } finally {
      f.cleanup();
    }
  });

  test("shuffle is deterministic per seed; level mix; JSON in prose is recovered", () => {
    expect(shuffled(["a", "b", "c"], 7)).toEqual(shuffled(["a", "b", "c"], 7));
    expect(levelMix(10)).toEqual({ newcomer: 4, intermediate: 4, expert: 2 });
    const res = { stop: "end", text: 'Here: {"answers": []} done' } as unknown as EngineResult;
    expect(structuredOf(res)).toEqual({ answers: [] });
    expect(structuredOf(null)).toBeNull();
  });
});
