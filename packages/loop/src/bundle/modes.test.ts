import { beforeAll, describe, expect, test } from "bun:test";
import type { Job } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { COPY_PREFACE } from "./build.ts";
import { createBundleBuilder } from "./index.ts";
import { codeAnchor, docAnchor, msg, thread } from "./test/builders.ts";
import { blobOf } from "./test/fake-anchor.ts";
import { checkGrammar, parse, tagsOf } from "./test/grammar.ts";
import { bundleInput, goSmallFiles, type World, world } from "./test/world.ts";

const FETCH = "internal/meta/fetch.go";
const AGENTS = "# Conventions\n\n## Go\n- gofmt と go vet が gate。\n\n## Deploy\nCloudflare を使う。\n";

let files: Record<string, string>;
beforeAll(() => {
  files = { ...goSmallFiles(), "AGENTS.md": AGENTS };
});

const sections = [
  {
    id: "s6/meta" as const,
    title: "メタデータ取得",
    blocks: [
      {
        id: "b_meta0002" as const,
        md: "失敗はそのまま呼び出し元へ返す。（[internal/meta/fetch.go:41-49](internal/meta/fetch.go#L41-L49)）",
        claims: [{ id: "cl_meta0001" as const, cites: [{ path: FETCH, start: 41, end: 49, blob: "x", snippet: "y", precision: "exact" as const }] }],
      },
    ],
  },
];

function setup(over: Parameters<typeof world>[0] extends infer O ? Partial<O> : never = {}): { w: World; builder: ReturnType<typeof createBundleBuilder> } {
  const w = world({ files, module: "example.com/tsundoku", sections, ...over });
  return { w, builder: createBundleBuilder(w.deps) };
}
const ask = (id = "th_17ab3c9d", intent: "question" | "change" | "note" | "doc_edit" | "review" = "change", over = {}) =>
  thread({ id: id as never, intent, anchor: codeAnchor(FETCH, 43, 47), messages: [msg("human", "ここを直したい", 1)], ...over });

describe("pull bundles (spec §4.7, R1)", () => {
  const pull = (threads: ReturnType<typeof ask>[], write: string[], over = {}) => bundleInput({ mode: "pull", out: "reply", threads, write, ...over });

  test("shape: no numbers, no DENY / GATE / fixed ACCEPT, the DO block names the thread id, BUDGET last", async () => {
    const { builder } = setup();
    const b = await builder.build(pull([ask()], [FETCH], { deny: [".env"], gates: [{ id: "fmt:gofmt", trusted: true }] }), 4000);
    const p = checkGrammar(b.text);
    expect(p.top).toEqual(["MBF/1 mode=pull out=reply lang=ja"]);
    expect(p.data.some((l) => /^\d+\|/.test(l))).toBe(false);
    expect(p.data.some((l) => l.startsWith("|"))).toBe(true);
    expect(tagsOf(b.text)).not.toContain("DENY");
    expect(tagsOf(b.text)).not.toContain("GATE");
    expect(tagsOf(b.text)).not.toContain("ACCEPT");
    expect(p.tail.slice(-6)).toEqual([
      "DO",
      '- Edit only WRITE paths in this working tree, then run: mitori reply th_17ab3c9d --done "<what changed>"',
      '- If it is a question or you will not change code: mitori reply th_17ab3c9d --answer "<answer citing path:line>"',
      '- If you need the human: mitori reply th_17ab3c9d --question "<what you need>"',
      "BUDGET in=4000 out=1500 usd=0.10",
      "END",
    ]);
  });

  test("numbered lines on request (mitori bundle --lines)", async () => {
    const { builder } = setup();
    const b = await builder.build({ ...pull([ask()], [FETCH]), numbered: true } as never, 4000);
    expect(parse(b.text).data.some((l) => /^43\|/.test(l))).toBe(true);
  });

  test("tier budgets: a question is XS, a small change S, a big one up to the cap (4,000)", async () => {
    const { builder } = setup();
    const q = await builder.build(pull([ask("th_17ab3c9d", "question")], []), 4000);
    expect(q.tokens).toBeLessThanOrEqual(800);
    const note = await builder.build(pull([ask("th_17ab3c9d", "note")], []), 4000);
    expect(note.tokens).toBeLessThanOrEqual(800);
    const small = await builder.build(pull([ask()], [FETCH]), 4000);
    expect(small.tokens).toBeLessThanOrEqual(1500);
    const big = await builder.build(
      pull([ask("th_17ab3c9d", "change", { anchor: codeAnchor("internal/server/server.go", 1, 151) })], ["internal/server/server.go"]),
      4000,
    );
    expect(big.tokens).toBeGreaterThan(1500);
    expect(big.tokens).toBeLessThanOrEqual(4000);
    // the cap is the caller's budget
    const capped = await builder.build(
      pull([ask("th_17ab3c9d", "change", { anchor: codeAnchor("internal/server/server.go", 1, 151) })], ["internal/server/server.go"]),
      2000,
    );
    expect(capped.tokens).toBeLessThanOrEqual(2000 + 200);
  });

  test("a doc_edit keeps its one task-specific ACCEPT bullet", async () => {
    const { builder } = setup();
    const b = await builder.build(pull([ask("th_17ab3c9d", "doc_edit")], [FETCH]), 4000);
    expect(b.text).toContain("ACCEPT\n- After the change, the new DOC text is true of the code.\nDO\n");
  });
});

describe("copy bundles (spec §4.7)", () => {
  const copy = (threads: ReturnType<typeof ask>[], target: "claude-code" | "codex" | "generic", over = {}) =>
    bundleInput({ mode: "copy", out: "reply", threads, write: [FETCH], deny: [".env", ".git/**"], target, ...over });

  test("self-contained: the preface line, DENY, the full ACCEPT block, DO, numbered code", async () => {
    const { builder } = setup();
    const b = await builder.build(copy([ask()], "claude-code"), 4000);
    expect(b.text.startsWith(`${COPY_PREFACE}\nMBF/1 mode=copy out=reply lang=ja\nDENY .env .git/**\n<<<DATA `)).toBe(true);
    checkGrammar(b.text);
    expect(parse(b.text).tail).toEqual([
      "ASK",
      "> ここを直したい",
      `WRITE ${FETCH}`,
      "ACCEPT",
      "- Only files listed in WRITE change.",
      "- Behaviour not mentioned in ASK stays the same.",
      "DO",
      '- Edit only WRITE paths in this working tree, then run: mitori reply th_17ab3c9d --done "<what changed>"',
      '- If it is a question or you will not change code: mitori reply th_17ab3c9d --answer "<answer citing path:line>"',
      '- If you need the human: mitori reply th_17ab3c9d --question "<what you need>"',
      "BUDGET in=4000 out=1500 usd=0.10",
      "END",
    ]);
    expect(parse(b.text).data.some((l) => /^43\|/.test(l))).toBe(true);
  });

  test("codex gets the mitori DO lines too; generic (no mitori in that environment) just reports", async () => {
    const { builder } = setup();
    const codex = await builder.build(copy([ask()], "codex"), 4000);
    expect(codex.text).toContain("mitori reply th_17ab3c9d --done");
    const generic = await builder.build(copy([ask()], "generic"), 4000);
    expect(generic.text).toContain("DO\n- Edit only WRITE paths. Report what you changed.\nBUDGET");
    expect(generic.text).not.toContain("mitori reply");
  });

  test("a copy bundle never carries GATE (mitori runs no gates for it)", async () => {
    const { builder } = setup();
    const b = await builder.build(copy([ask()], "generic", { gates: [{ id: "fmt:gofmt", trusted: true }] }), 4000);
    expect(tagsOf(b.text)).not.toContain("GATE");
  });

  test("copyPrompt: a synthetic thread from the anchor and the ask; change ⇒ WRITE from the router derivation, question ⇒ WRITE -", async () => {
    const { builder } = setup();
    const doc = docAnchor("b_meta0002", { claim: "cl_meta0001" });
    const change = await builder.copyPrompt({ anchor: doc, ask: "再試行を追加して", intent: "change", target: "claude-code" });
    checkGrammar(change.text);
    expect(change.text).toContain(`\nWRITE ${FETCH}\n`);
    expect(change.text).toContain("TASK th_00000000 change R1");
    expect(change.text).toContain("DO\n- Edit only WRITE paths. Report what you changed.");
    expect(change.text).not.toContain("mitori reply");
    expect(change.tokens).toBeGreaterThan(200);
    const q = await builder.copyPrompt({ anchor: codeAnchor(FETCH, 43, 47), ask: "なぜ?", intent: "question", target: "generic" });
    expect(q.text).toContain("\nWRITE -\n");
    expect(q.text).toContain("> なぜ?");
  });

  test("copyPrompt on a denied file is E_DENY_GLOB (copy_prompt would not help: nothing to copy)", async () => {
    const { builder } = setup({ files: { ...files, ".env": "TOKEN=1\n" }, deny: [".env"] });
    const err = await builder.copyPrompt({ anchor: codeAnchor(".env", 1, 1), ask: "x", intent: "change", target: "generic" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MitoriError);
    expect((err as MitoriError).code).toBe("E_DENY_GLOB");
  });
});

describe("RULES (spec §4.8)", () => {
  test("untrusted rule files are not used and show up as RULES=untrusted", async () => {
    for (const trust of ["pending", "denied"] as const) {
      const { builder } = setup({ trust });
      const b = await builder.build(bundleInput({ threads: [ask()], write: [FETCH] }), 4000);
      expect(tagsOf(b.text)).not.toContain("RULES");
      expect(b.text).toContain("\nOMITTED RULES=untrusted\n");
      expect(b.omitted).toEqual([{ kind: "RULES_UNTRUSTED", count: 1 }]);
    }
  });

  test("the trust hash covers the files used (path + content), so an edit asks again", async () => {
    const seen: string[] = [];
    const trust = (_: "rules", hash: string) => {
      seen.push(hash);
      return "trusted" as const;
    };
    const mk = (f: Record<string, string>) => createBundleBuilder({ ...world({ files: f, module: "example.com/tsundoku" }).deps, trust });
    await mk(files).build(bundleInput({ threads: [ask()], write: [FETCH] }), 4000);
    await mk({ ...files, "AGENTS.md": `${AGENTS}\n## More\nx\n` }).build(bundleInput({ threads: [ask()], write: [FETCH] }), 4000);
    await mk(files).build(bundleInput({ threads: [ask()], write: [FETCH] }), 4000);
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/u);
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });

  test("sections are scored by the write scope (path words, language, topics); score 0 is left out; CLAUDE.md linking to AGENTS.md counts once", async () => {
    const md = "# Rules\n\n## Go\n- gofmt を使う。\n\n## Deploy\nCloudflare を使う。\n\n## Testing\nテストは table-driven。\n\n## Python\npytest を使う。\n";
    const { builder } = setup({ files: { ...files, "AGENTS.md": md, "CLAUDE.md": md } });
    const b = await builder.build(bundleInput({ threads: [ask()], write: [FETCH] }), 4000);
    const rules = parse(b.text).data.filter((l) => l.startsWith("RULES "));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatch(/^RULES AGENTS\.md#Go,Testing 2\/4$/u);
    expect(b.text).toContain("gofmt を使う");
    expect(b.text).not.toContain("Cloudflare を使う");
    expect(b.text).not.toContain("pytest");
  });

  test("a nearer AGENTS.md (an ancestor directory of the write scope) is a source too; RepoSettings.rules overrides the defaults", async () => {
    const f = { ...files, "internal/meta/AGENTS.md": "## Meta\nfetch.go のエラーは wrap する。\n" };
    const near = await setup({ files: f }).builder.build(bundleInput({ threads: [ask()], write: [FETCH] }), 4000);
    expect(near.text).toMatch(/RULES [^\n]*internal\/meta\/AGENTS\.md#Meta/u);
    const only = await setup({ files: f, rules: ["AGENTS.md"] }).builder.build(bundleInput({ threads: [ask()], write: [FETCH] }), 4000);
    expect(only.text).not.toContain("internal/meta/AGENTS.md");
  });

  test("the slice stays within 150 tokens and cuts the last section at a sentence boundary", async () => {
    const long = `## Go\n${Array.from({ length: 60 }, (_, i) => `ルール${i}: gofmt を必ず通す。`).join("\n")}\n`;
    const { builder } = setup({ files: { ...files, "AGENTS.md": long } });
    const b = await builder.build(bundleInput({ threads: [ask()], write: [FETCH] }), 12000);
    const data = parse(b.text).data;
    const i = data.findIndex((l) => l.startsWith("RULES "));
    const body = data.slice(
      i + 1,
      data.findIndex((l, k) => k > i && !l.startsWith("> ")),
    );
    const rulesTokens = b.items.find((x) => x.key === "rules")?.tokens ?? 0;
    expect(rulesTokens).toBeLessThanOrEqual(150 + 12);
    expect(body.join("").endsWith("。")).toBe(true);
  });

  test("answer / findings bundles carry no RULES (no scope to follow them)", async () => {
    const { builder } = setup();
    const b = await builder.build(bundleInput({ mode: "answer", out: "answer/1", threads: [ask("th_17ab3c9d", "question")], write: [] }), 4000);
    expect(tagsOf(b.text)).not.toContain("RULES");
    expect(b.omitted).toEqual([]);
  });
});

describe("REL (spec §4.3)", () => {
  test("callees (same file and imported) and callers (same file and dependents) of the anchored symbol, by weight", async () => {
    const { builder } = setup();
    const t = ask("th_17ab3c9d", "change", { anchor: codeAnchor(FETCH, 41, 49) });
    const b = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 12000);
    const data = parse(b.text).data;
    const rel = data.filter((l) => l.startsWith("REL "));
    expect(rel).toContain("REL internal/meta/fetch.go:36 sym=NormalizeISBN calledby=Client.Fetch");
    expect(rel.some((l) => l.startsWith("REL internal/meta/fetch.go:51 sym=Client.fetchOnce calledby=Client.Fetch"))).toBe(true);
    expect(rel).toContain("REL internal/server/server.go:83 sym=Server.createBook calls=Client.Fetch");
    const i = data.indexOf("REL internal/meta/fetch.go:36 sym=NormalizeISBN calledby=Client.Fetch");
    expect(data[i + 1]).toBe("|func NormalizeISBN(raw string) string");
    expect(rel.length).toBeLessThanOrEqual(10);
    // symbols inside the shown code are not repeated
    const shown = data.find((l) => l.startsWith("CODE ")) as string;
    expect(shown).toContain("fetch.go:41-49");
    for (const l of rel) expect(l).not.toMatch(/fetch\.go:4[1-9] /u);
  });

  test("an anchor without an enclosing symbol, or an answer bundle, has no REL", async () => {
    const { builder } = setup();
    const t = ask("th_17ab3c9d", "change", { anchor: codeAnchor(FETCH, 2, 3) });
    expect(tagsOf((await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 12000)).text)).not.toContain("REL");
  });

  test("denied dependents are never read", async () => {
    const { w, builder } = setup({ deny: ["internal/server/**"] });
    const t = ask("th_17ab3c9d", "change", { anchor: codeAnchor(FETCH, 41, 49) });
    const b = await builder.build(bundleInput({ threads: [t], write: [FETCH], deny: ["internal/server/**"] }), 12000);
    expect(b.text).not.toContain("server.go");
    expect(w.deps.indexer.reads.every((r) => !r.path.startsWith("internal/server/"))).toBe(true);
  });
});

describe("repair turns (spec §6.6.3)", () => {
  const job = { id: "j_0000000001", route: { contract: "patch/1" }, gates: [{ gate: "typecheck:tsc", status: "fail", ms: 10 }], attempt: 1 } as unknown as Job;
  const text = ["package a", "", "func a() int {", '\treturn "3"', "}", "", "func b() {}", ""].join("\n");
  const withJob = () => {
    const { w } = setup({ files: { ...files, "src/a.go": text } });
    return createBundleBuilder({ ...w.deps, readJobFile: async (_j, p) => (p === "src/a.go" ? { text, blob: blobOf(text) } : null) });
  };
  const ranges = [{ path: "src/a.go", start: 3, end: 5 }];

  test("gate failure: GATE line with attempt, excerpt as | lines, current CODE with the new base, one ASK", async () => {
    const r = await withJob().repair({ job, kind: "gate", excerpt: 'src/a.go:4:9 - error: cannot use "3" as int\n  4 |\treturn "3"', ranges });
    const base = blobOf(text).slice(0, 7);
    expect(r.text.replace(/<<<(DATA|END) \w{8}>>>/gu, "<<<$1 n>>>")).toBe(
      [
        "MBF/1 mode=repair out=patch/1",
        "<<<DATA n>>>",
        "GATE typecheck:tsc fail attempt=1/2",
        '|src/a.go:4:9 - error: cannot use "3" as int',
        '|  4 |\treturn "3"',
        `CODE src/a.go:1-7 base=${base} anchor=3-5`,
        "1|package a",
        "2|",
        "3|func a() int {",
        '4|\treturn "3"',
        "5|}",
        "6|",
        "7|func b() {}",
        "<<<END n>>>",
        "ASK",
        `> Fix the failing GATE above. Your previous edits are already applied; return edits against the CODE shown here (base=${base}).`,
        "END",
        "",
      ].join("\n"),
    );
    expect(r.blobs).toEqual({ "src/a.go": blobOf(text) });
    expect(r.tokens).toBeGreaterThan(40);
    expect(r.tokens).toBeLessThan(300);
  });

  test("apply failure and invalid output name the problem block; revise puts the human's words in ASK verbatim", async () => {
    const b = withJob();
    const apply = await b.repair({ job, kind: "apply", excerpt: "edit 1: first_line does not match line 41", ranges });
    expect(apply.text).toContain("\nPATCH fail\n|edit 1: first_line does not match line 41\n");
    expect(apply.text).toContain("> Your previous edits could not be applied (see PATCH above). Return corrected edits against the CODE shown here (base=");
    const bad = await b.repair({ job, kind: "invalid_output", excerpt: "/edits/0/path: expected a path listed in WRITE", ranges });
    expect(bad.text).toContain("\nOUTPUT invalid\n|/edits/0/path: expected a path listed in WRITE\n");
    expect(bad.text).toContain("> Your previous output was invalid (see OUTPUT above). Return it again, fixed, in the same contract.\nEND\n");
    const revise = await b.repair({ job, kind: "revise", excerpt: "", humanMessage: "もっと小さく\n`maxRetries` は 3 まで", ranges });
    expect(revise.text).toContain("ASK\n> もっと小さく\n> `maxRetries` は 3 まで\nEND\n");
    expect(revise.text).not.toContain("GATE ");
    expect(revise.text).toContain("CODE src/a.go:");
  });

  test("an agent job gets the failure but no CODE (it re-reads files itself); secrets in the excerpt are redacted", async () => {
    const agent = { ...job, route: { contract: "agent/1" } } as unknown as Job;
    const r = await withJob().repair({ job: agent, kind: "gate", excerpt: "token AKIAIOSFODNN7EXAMPLQ in output", ranges });
    expect(r.text).toContain("MBF/1 mode=repair out=agent/1\n");
    expect(tagsOf(r.text)).not.toContain("CODE");
    expect(r.text).not.toContain("AKIAIOSFODNN7EXAMPLQ");
    expect(r.text).toContain("Fix the failing GATE above. Your previous edits are already applied; return the result in the same contract.");
    expect(r.blobs).toEqual({});
  });

  test("denied files and unreadable job files are skipped; two files give a hint about the bases", async () => {
    const other = "x\ny\n";
    const { w } = setup({ files: { ...files, "src/a.go": text, "b.go": other }, deny: ["secret/**"] });
    const b = createBundleBuilder({
      ...w.deps,
      readJobFile: async (_j, p) => (p === "src/a.go" ? { text, blob: blobOf(text) } : p === "b.go" ? { text: other, blob: blobOf(other) } : null),
    });
    const r = await b.repair({
      job,
      kind: "apply",
      excerpt: "x",
      ranges: [...ranges, { path: "b.go", start: 1, end: 2 }, { path: "secret/k.go", start: 1, end: 1 }, { path: "gone.go", start: 1, end: 1 }],
    });
    expect(tagsOf(r.text).filter((t) => t === "CODE")).toHaveLength(2);
    expect(r.text).toContain("(use the base= of each CODE header)");
    expect(Object.keys(r.blobs).sort()).toEqual(["b.go", "src/a.go"]);
  });
});
