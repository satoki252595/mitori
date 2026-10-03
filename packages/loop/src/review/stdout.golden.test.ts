/**
 * `mitori.review/1` golden (go-small demo round) + the ≤ 50 token/thread overhead budget (`loop.pull.overhead`)
 * + AC-L11 (human bodies byte-identical after a parse-back, LF only). Also anchor labels, the decision record and
 * the doc_edit ask.
 */
import { describe, expect, test } from "bun:test";
import { CHARS_PER_TOKEN, type Decision, type Message, type ThreadDetail, type ThreadId, type ThreadIntent } from "@mitori/core";
import { REVIEW_STDOUT } from "../contract.ts";
import { anchorLabel, displayState, renderDecisionMarkdown, renderDocEditAsk, renderReviewStdout } from "./index.ts";
import { golden } from "./test/fakes.ts";

const AT = "2026-10-03T09:00:00.000Z";

function thread(id: string, intent: ThreadIntent, anchor: ThreadDetail["anchor"], extra: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: id as ThreadId,
    anchor,
    anchorHealth: "ok",
    stale: false,
    intent,
    state: "queued",
    round: 3,
    version: 2,
    title: id,
    jobs: [],
    createdAt: AT,
    updatedAt: AT,
    messages: [],
    jobViews: [],
    ...extra,
  };
}

function msg(thread: string, body: string, round = 3): Message {
  return { id: `m_${thread.slice(3)}00`.slice(0, 12) as Message["id"], thread: thread as ThreadId, by: "human", kind: "comment", body, round, createdAt: AT };
}

const ctx = {
  sectionOf: (b: string) => (b === "b_k3f9a2cq" ? "s3/retry" : null),
  diagramNodeLabel: (_dg: string, node: string) => (node === "n_fetch" ? "meta.Fetch（外部 API 呼び出し）" : null),
};

const CODE = thread("th_k3f9a2cq", "change", { primary: "code", code: { path: "internal/meta/fetch.go", start: 40, end: 52, blob: "b1", snippet: "s1" } });
const DOC = thread(
  "th_m7p2x9ka",
  "question",
  {
    primary: "doc",
    doc: { block: "b_k3f9a2cq", blockHash: "h", quote: { prefix: "", exact: "生成失敗時は正確に 1 回だけ再試行する", suffix: "" }, offset: 0 },
  },
  { anchorHealth: "outdated" },
);
const DIAGRAM = thread("th_q4w8e2rt", "review", { primary: "diagram", diagram: { diagram: "dg_a1b2c3d4", node: "n_fetch" } });
const NOTE = thread("th_z9y8x7wv", "note", { primary: "code", code: { path: "internal/store/memory.go", start: 12, end: 12, blob: "b2", snippet: "s2" } });

const BODIES: Record<string, string[]> = {
  th_k3f9a2cq: ["リトライを 2 回に増やして、間隔は 500ms にしてください。", "あと、ログに試行回数を出して。\n\n  インデントも原文のまま\t(tab)"],
  th_m7p2x9ka: ['この文はまだ正しい？ "quoted" & <html>'],
  th_q4w8e2rt: ["外部 API の失敗時の挙動をレビューして。"],
  th_z9y8x7wv: ["メモ: ここは後でロックを見直す"],
};

function round3() {
  const threads = [CODE, DOC, DIAGRAM, NOTE].map((t, i) => {
    const e: { thread: ThreadDetail; humanMessages: Message[]; anchorLabel: string; carriedFrom?: number; bundleTokens?: number } = {
      thread: t,
      humanMessages: (BODIES[t.id] as string[]).map((b) => msg(t.id, b)),
      anchorLabel: anchorLabel(t.anchor, ctx),
      bundleTokens: [1120, 640, 980, 520][i] as number,
    };
    if (i === 0) e.carriedFrom = 2;
    return e;
  });
  return renderReviewStdout({ round: 3, threads, approved: false });
}

/** Token estimate: ASCII at the code ratio, the rest at the Japanese prose ratio (claude-v5). */
function tokens(s: string): number {
  let ascii = 0;
  for (const ch of s) if (ch.charCodeAt(0) < 0x80) ascii++;
  return ascii / CHARS_PER_TOKEN["claude-v5"].code + ([...s].length - ascii) / CHARS_PER_TOKEN["claude-v5"].markdown_ja;
}

describe("mitori.review/1 (spec §10.1, R1 UXP-02/UXP-33)", () => {
  test("golden: fixtures/golden/go-small/review/round-3.stdout.txt", () => {
    const g = golden("go-small/review/round-3.stdout.txt", round3());
    expect(g.actual).toBe(g.expected);
  });

  test("overhead ≤ 50 tokens per thread (heading + `> ` prefixes + separators; bodies excluded)", () => {
    const out = round3();
    const sections = out.split("\n## ").slice(1);
    expect(sections.length).toBe(4);
    for (const s of sections) {
      const lines = s.replace(/\n\nNEXT: .*\n$/, "").split("\n");
      const heading = `## ${lines[0]}`;
      const bodyLines = lines.slice(1);
      const overhead = tokens(heading) + bodyLines.length * 1; // `> ` / `>` ≈ 1 token per line
      expect(overhead).toBeLessThanOrEqual(REVIEW_STDOUT.overheadTokensPerThread);
    }
  });

  test("AC-L11: human bodies are byte-identical after parsing the stdout back", () => {
    const out = round3();
    for (const s of out.split("\n## ").slice(1)) {
      const lines = s.replace(/\n\nNEXT: .*\n$/, "").split("\n");
      const id = (lines[0] as string).split(" ")[0] as string;
      const bodies: string[] = [];
      let cur: string[] = [];
      for (const l of lines.slice(1)) {
        if (l === ">") {
          bodies.push(cur.join("\n"));
          cur = [];
        } else cur.push(l.slice(2));
      }
      bodies.push(cur.join("\n"));
      expect(bodies).toEqual(BODIES[id] as string[]);
    }
  });

  test("header flags: carried, outdated, bundle≈k, memo for notes", () => {
    const out = round3();
    expect(out).toContain("## th_k3f9a2cq change R3 carried=R2 internal/meta/fetch.go:40-52 bundle≈1.1k\n");
    expect(out).toContain('## th_m7p2x9ka question R3 outdated §s3/retry "生成失敗時は正確に 1 回だけ再試行する" bundle≈0.6k\n');
    expect(out).toContain("## th_q4w8e2rt review R3 diagram:dg_a1b2c3d4/meta.Fetch（外部 API 呼び出し） bundle≈1.0k\n");
    expect(out).toContain("## th_z9y8x7wv note R3 internal/store/memory.go:12-12 bundle≈0.5k (memo: do not edit code)\n");
    expect(out.startsWith("mitori.review/1 round=3 threads=4 approved=false\n")).toBe(true);
    expect(out.endsWith("\nNEXT: mitori review --round 4\n")).toBe(true);
  });

  test("approved round", () => {
    expect(renderReviewStdout({ round: 5, threads: [], approved: true })).toBe(
      "mitori.review/1 round=5 threads=0 approved=true\nNo open threads. The review is approved.\nNEXT: none\n",
    );
  });
});

describe("anchorLabel / displayState", () => {
  test("code, doc (quote / whole block / unknown section), diagram (node, edge, whole), escaping", () => {
    expect(anchorLabel(CODE.anchor, ctx)).toBe("internal/meta/fetch.go:40-52");
    expect(anchorLabel({ primary: "doc", doc: { block: "b_k3f9a2cq", blockHash: "h" } }, ctx)).toBe("§s3/retry b_k3f9a2cq");
    expect(anchorLabel({ primary: "doc", doc: { block: "b_zzzzzzzz", blockHash: "h", quote: { prefix: "", exact: 'a "b"\nc', suffix: "" } } }, ctx)).toBe(
      'b_zzzzzzzz "a \\"b\\" c"',
    );
    expect(anchorLabel({ primary: "doc", doc: { block: "b_k3f9a2cq", blockHash: "h", quote: { prefix: "", exact: "x".repeat(50), suffix: "" } } }, ctx)).toBe(
      `§s3/retry "${"x".repeat(40)}"`,
    );
    expect(anchorLabel({ primary: "diagram", diagram: { diagram: "dg_a1b2c3d4", node: "n_other" } }, ctx)).toBe("diagram:dg_a1b2c3d4/n_other");
    expect(anchorLabel({ primary: "diagram", diagram: { diagram: "dg_a1b2c3d4", edge: "e1" } }, ctx)).toBe("diagram:dg_a1b2c3d4/e1");
    expect(anchorLabel({ primary: "diagram", diagram: { diagram: "dg_a1b2c3d4" } }, ctx)).toBe("diagram:dg_a1b2c3d4");
  });

  test("outdated is a display state only (not for resolved / draft)", () => {
    expect(displayState({ state: "open", anchorHealth: "outdated" })).toBe("outdated");
    expect(displayState({ state: "resolved", anchorHealth: "outdated" })).toBe("resolved");
    expect(displayState({ state: "draft", anchorHealth: "outdated" })).toBe("draft");
    expect(displayState({ state: "answered", anchorHealth: "fuzzy" })).toBe("answered");
  });
});

describe("decision record and doc_edit ask (§2.6)", () => {
  const d: Decision = {
    id: "dc_r3t5y7u9",
    title: "リトライは  1 回だけ",
    status: "accepted",
    thread: "th_k3f9a2cq",
    blocks: ["b_k3f9a2cq"],
    cites: [],
    file: "decisions/dc_r3t5y7u9.md",
    decidedAt: "2026-10-03T12:34:56.000Z",
  };

  test("golden: fixtures/golden/go-small/review/decision.md", () => {
    const md = renderDecisionMarkdown(d, {
      context: "なぜ 1 回だけ？\r\n上流の制限？",
      decision: "上流 API の制限で 1 回に固定する。",
      discussion: [
        { by: "human", round: 1, body: "なぜ 1 回だけ？\n上流の制限？" },
        { by: "agent:claude-cli/claude-sonnet-5-5", round: 1, body: `上流 API の制限で 1 回に固定する。${"長".repeat(130)}` },
      ],
      docLinks: [{ label: "§3.2 認証フロー", href: "../doc/03-key-flows.md#b_k3f9a2cq" }],
      codeLinks: [{ label: "internal/meta/fetch.go:40-52", href: "../../internal/meta/fetch.go#L40-L52" }],
    });
    const g = golden("go-small/review/decision.md", md);
    expect(g.actual).toBe(g.expected);
    expect(md.split("\n").find((l) => l.startsWith("- R1 agent"))?.length).toBeLessThanOrEqual("- R1 agent:claude-cli/claude-sonnet-5-5: ".length + 120);
  });

  test("doc_edit ask: fixed header, `> ` lines, `>` for empty lines", () => {
    expect(renderDocEditAsk("一行目\n\n三行目\n", "新しい\r\n本文")).toBe(
      "設計書をこの版に合わせてコードを変更してください。\n--- 現在の設計書\n> 一行目\n>\n> 三行目\n+++ 新しい設計書\n> 新しい\n> 本文",
    );
  });
});
