import { beforeAll, describe, expect, test } from "bun:test";
import { MitoriError } from "@mitori/core";
import { BUNDLE_DROP_ORDER, BUNDLE_NEVER_DROP, type Bundle } from "../contract.ts";
import { createBundleBuilder } from "./index.ts";
import { codeAnchor, msg, thread } from "./test/builders.ts";
import { checkGrammar, parse, tagsOf } from "./test/grammar.ts";
import { bundleInput, goSmallFiles, world } from "./test/world.ts";

const FETCH = "internal/meta/fetch.go";
const AGENTS =
  "# Conventions\n\n## Go\n- gofmt と go vet が gate。\n- エラーは fmt.Errorf で wrap する。\n\n## Errors\nsentinel error は store.ErrNotFound のように公開する。\n\n## Tests\nテストは table-driven にする。meta の変更は fetch_test.go を更新する。\n";
const sections = [
  {
    id: "s6/meta" as const,
    title: "メタデータ取得",
    blocks: [
      { id: "b_meta0001" as const, kind: "heading" as const, md: "## 取得 <!-- b_meta0001 -->" },
      { id: "b_meta0002" as const, md: "ISBN を正規化してから 1 回だけ問い合わせる。 <!-- b_meta0002 -->" },
      {
        id: "b_meta0003" as const,
        md: "失敗はそのまま呼び出し元へ返す。（[internal/meta/fetch.go:41-49](internal/meta/fetch.go#L41-L49)） <!-- b_meta0003 -->",
      },
      { id: "b_meta0004" as const, md: "HTTP 200 以外はエラーにする。 <!-- b_meta0004 -->" },
    ],
  },
];

let files: Record<string, string>;
beforeAll(() => {
  files = { ...goSmallFiles(), "AGENTS.md": AGENTS };
});

function rich() {
  const w = world({ files, module: "example.com/tsundoku", sections });
  const messages = [
    ...Array.from({ length: 6 }, (_, i) =>
      msg(
        i % 2 ? "agent:claude-cli/claude-sonnet-5-5" : "human",
        `earlier message number ${i + 1} about the retry behaviour of the catalogue client`,
        1,
        i % 2 ? "answer" : "comment",
        i + 1,
      ),
    ),
    msg("human", "Fetch の失敗時の挙動を変えたい", 2, "comment", 7),
  ];
  const t = thread({
    id: "th_17ab3c9d",
    intent: "change",
    anchor: {
      ...codeAnchor(FETCH, 43, 47),
      doc: { block: "b_meta0003", blockHash: "x", quote: { prefix: "", exact: "そのまま呼び出し元へ返す", suffix: "" } },
    },
    messages,
  });
  return { w, builder: createBundleBuilder(w.deps), t };
}

function omittedOf(b: Bundle): Record<string, number> {
  return Object.fromEntries(b.omitted.map((o) => [o.kind, o.count]));
}

/** The drop-order invariants of AC-L24: a later stage starts only when the earlier ones are exhausted. */
function assertDropOrder(b: Bundle): void {
  const text = b.text;
  const om = omittedOf(b);
  const has = {
    rel: tagsOf(text).includes("REL"),
    rules: tagsOf(text).includes("RULES"),
    neighbors: /^> ~(?:prev|next): /mu.test(text),
    thread: /^THREAD /mu.test(text),
  };
  if (om.CODE_CONTEXT) expect([has.thread, has.neighbors, has.rules, has.rel]).toEqual([false, false, false, false]);
  if (om.THREAD_OLD) expect([has.neighbors, has.rules, has.rel]).toEqual([false, false, false]);
  if (om.DOC_NEIGHBORS) expect([has.rules, has.rel]).toEqual([false, false]);
  if (om.RULES) expect(has.rel).toBe(false);
  // the OMITTED line states exactly what bundle.omitted says, in BUNDLE_DROP_ORDER
  const line = text.split("\n").find((l) => l.startsWith("OMITTED "));
  const stated = Object.fromEntries((line?.slice(8).split(" ") ?? []).map((kv) => [kv.split("=")[0], Number(kv.split("=")[1])]));
  expect(stated).toEqual(om);
  const order = Object.keys(stated).map((k) => (BUNDLE_DROP_ORDER as readonly string[]).indexOf(k));
  expect([...order].sort((a, b2) => a - b2)).toEqual(order);
}

function assertNeverDropped(b: Bundle): void {
  const text = b.text;
  const { data, tail } = parse(text);
  expect(text.startsWith("MBF/1 mode=patch")).toBe(true);
  expect(data).toContain("TASK th_17ab3c9d change R1");
  expect(data.some((l) => l.startsWith("DOC b_meta0003 "))).toBe(true);
  expect(data).toContain("SEL");
  expect(tail).toContain("ASK");
  expect(tail).toContain("> Fetch の失敗時の挙動を変えたい");
  for (let l = 43; l <= 47; l++) expect(data.some((d) => d.startsWith(`${l}|`))).toBe(true); // every anchor line
  expect(tail.some((l) => l === `WRITE ${FETCH}`)).toBe(true);
  expect(tail.some((l) => l.startsWith("BUDGET "))).toBe(true);
  expect(BUNDLE_NEVER_DROP).toContain("ASK");
}

describe("AC-L24 drop order", () => {
  test("a full bundle has every optional part and no OMITTED line", async () => {
    const { builder, t } = rich();
    const b = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 12000);
    const tags = tagsOf(b.text);
    for (const tag of ["RULES", "REL", "THREAD"]) expect([tag, tags.includes(tag)]).toEqual([tag, true]);
    expect(b.text).toMatch(/^> ~prev: /mu);
    expect(b.text).toMatch(/^> ~next: /mu);
    expect(b.omitted).toEqual([]);
    expect(tags).not.toContain("OMITTED");
  });

  test("shrinking the budget drops REL → RULES → DOC_NEIGHBORS → THREAD_OLD → CODE_CONTEXT, in that order, and keeps the never-drop parts", async () => {
    const { builder, t } = rich();
    const full = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 12000);
    const stages = new Set<string>();
    let previous = Number.POSITIVE_INFINITY;
    for (let budget = full.tokens; budget >= 200; budget -= 25) {
      const b = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), budget);
      checkGrammar(b.text);
      assertDropOrder(b);
      assertNeverDropped(b);
      expect(b.tokens).toBeLessThanOrEqual(previous);
      previous = b.tokens;
      if (!b.overBudget && b.tokens > budget) {
        // only possible when nothing optional is left — then the mandatory part exceeds the (raised) budget
        expect(b.omitted.some((o) => o.kind === "CODE_CONTEXT")).toBe(true);
      }
      for (const o of b.omitted) stages.add(o.kind);
    }
    expect([...stages].sort()).toEqual([...BUNDLE_DROP_ORDER].sort());
  });

  test("REL goes one entry at a time (counted), lowest weight first", async () => {
    const { builder, t } = rich();
    const full = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 12000);
    const rels = full.items.filter((i) => i.kind === "related");
    expect(rels.length).toBeGreaterThanOrEqual(2);
    const one = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), full.tokens - 1);
    expect(omittedOf(one)).toEqual({ REL: 1 });
    const kept = one.items.filter((i) => i.kind === "related").map((i) => i.key);
    expect(kept).toEqual(rels.slice(0, rels.length - 1).map((i) => i.key));
  });

  test("RULES shrinks to one line before it disappears", async () => {
    const { builder, t } = rich();
    const base = bundleInput({ threads: [t], write: [FETCH] });
    const noRel = await builder.build({ ...base, removed: ["related:internal/meta/fetch.go:1"] }, 12000);
    void noRel;
    // find a budget where only the one-line RULES remains
    let seen = false;
    const full = await builder.build(base, 12000);
    for (let budget = full.tokens; budget > 100 && !seen; budget -= 5) {
      const b = await builder.build(base, budget);
      const rulesAt = b.text.split("\n").findIndex((l) => l.startsWith("RULES "));
      if (rulesAt >= 0 && omittedOf(b).RULES === 1) {
        seen = true;
        const lines = parse(b.text).data;
        const i = lines.findIndex((l) => l.startsWith("RULES "));
        expect(lines[i + 1]?.startsWith("> ")).toBe(true);
        expect(lines[i + 2]?.startsWith("> ")).toBe(false); // exactly one quote line
        expect((lines[i + 1] as string).length).toBeLessThanOrEqual(2 + 120);
      }
    }
    expect(seen).toBe(true);
  });

  test("CODE_CONTEXT shrinks ±20 → ±10 → ±5 → 0 and counts the lines it removed", async () => {
    const { builder } = rich();
    const t = thread({ id: "th_17ab3c9d", anchor: codeAnchor("internal/server/server.go", 90, 95), messages: [msg("human", "ここ", 1)] });
    const base = bundleInput({ threads: [t], write: ["internal/server/server.go"] });
    const full = await builder.build(base, 12000);
    const head0 = parse(full.text).data.find((l) => l.startsWith("CODE ")) as string;
    expect(head0).toMatch(/server\.go:83-115 /u); // createBook, whole (33 lines)
    const widths: number[] = [];
    const removed: number[] = [];
    for (let budget = full.tokens; budget > 100; budget -= 10) {
      const b = await builder.build(base, budget);
      const head = parse(b.text).data.find((l) => l.startsWith("CODE ")) as string;
      const m = /:(\d+)-(\d+) /.exec(head) as RegExpExecArray;
      const width = Number(m[2]) - Number(m[1]) + 1;
      if (widths[widths.length - 1] !== width) {
        widths.push(width);
        removed.push(omittedOf(b).CODE_CONTEXT ?? 0);
      }
    }
    expect(widths).toEqual([33, 23, 16, 6]); // symbol, ±10 around 90-95 (clipped at the symbol), ±5, anchor only
    expect(removed).toEqual([0, 10, 17, 27]);
  });
});

describe("tier budgets (spec §4.4)", () => {
  test("mandatory parts above the asked budget: the budget is raised to what they need (≤ bundleMaxTokens), every optional part is dropped", async () => {
    const { builder, t } = rich();
    const b = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 100);
    expect(b.overBudget).toBe(false);
    expect(b.tokens).toBeGreaterThan(100);
    expect(b.tokens).toBeLessThanOrEqual(12000);
    expect(b.omitted.map((o) => o.kind)).toEqual([...BUNDLE_DROP_ORDER]);
    const smallest = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 1);
    expect(b.text).toBe(smallest.text);
  });

  test("mandatory parts above bundleMaxTokens: overBudget (patch) so the router sends the job to agent mode", async () => {
    const big = Array.from({ length: 1500 }, (_, i) => `\tvalue${i} := compute(${i}, "some string literal number ${i}")`).join("\n");
    const w = world({ files: { "big.go": `package big\n${big}\n` } });
    const t = thread({ anchor: codeAnchor("big.go", 2, 1400), messages: [msg("human", "全部直して", 1)] });
    const b = await createBundleBuilder(w.deps).build(bundleInput({ threads: [t], write: ["big.go"] }), 4000);
    expect(b.overBudget).toBe(true);
    expect(b.tokens).toBeGreaterThan(12000);
    expect(b.text).toContain("\n1400|");
    // agent mode gets reference lines instead of bodies
    const a = await createBundleBuilder(w.deps).build(bundleInput({ mode: "agent", out: "agent/1", threads: [t], write: ["big.go"] }), 4000);
    expect(a.overBudget).toBe(false);
    expect(parse(a.text).data.filter((l) => l.startsWith("CODE "))).toEqual([
      expect.stringMatching(/^CODE big\.go:2-1400 base=[0-9a-f]{7} anchor=2-1400 \(read with Read\)$/u),
    ]);
    expect(parse(a.text).data.some((l) => l.startsWith("|"))).toBe(false);
    expect(a.tokens).toBeLessThan(1000);
  });

  test("answer / findings above bundleMaxTokens: E_PAYLOAD_TOO_LARGE (narrow_scope); anchors are never cut", async () => {
    const big = Array.from({ length: 1500 }, (_, i) => `\tvalue${i} := compute(${i}, "some string literal number ${i}")`).join("\n");
    const w = world({ files: { "big.go": `package big\n${big}\n` } });
    const t = thread({ intent: "question", anchor: codeAnchor("big.go", 2, 1400), messages: [msg("human", "これは何?", 1)] });
    for (const [mode, out] of [
      ["answer", "answer/1"],
      ["findings", "findings/1"],
    ] as const) {
      const err = await createBundleBuilder(w.deps)
        .build(bundleInput({ mode, out, threads: [t] }), 4000)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MitoriError);
      expect((err as MitoriError).code).toBe("E_PAYLOAD_TOO_LARGE");
      expect((err as MitoriError).params?.actions).toBe("narrow_scope");
    }
  });
});

describe("chips (ContextAdjust.remove) and items", () => {
  test("items add up to Bundle.tokens (fixed and output excluded), keys follow the chip scheme", async () => {
    const { builder, t } = rich();
    const b = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 12000);
    const body = b.items.filter((i) => i.kind !== "fixed" && i.kind !== "output");
    expect(body.reduce((n, i) => n + i.tokens, 0)).toBe(b.tokens);
    const keys = b.items.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining(["fixed", "write", "rules", "ask", "doc:b_meta0003", "doc:neighbors", "thread", `code:${FETCH}:43-47`, "code:context", "output"]),
    );
    expect(keys.some((k) => k.startsWith("related:"))).toBe(true);
    expect(b.items.find((i) => i.key === "fixed")).toMatchObject({ kind: "fixed", tokens: 1400, cached: true, removable: false });
    expect(b.items.find((i) => i.key === "output")).toMatchObject({ kind: "output", tokens: 1500, removable: false });
    const code = b.items.find((i) => i.key === `code:${FETCH}:43-47`);
    expect(code).toMatchObject({ kind: "code", path: FETCH, lines: 5, removable: false });
    for (const k of ["write", "ask", "doc:b_meta0003", `code:${FETCH}:43-47`]) expect(b.items.find((i) => i.key === k)?.removable).toBe(false);
    for (const k of ["rules", "doc:neighbors", "thread", "code:context"]) expect(b.items.find((i) => i.key === k)?.removable).toBe(true);
  });

  test("the fixed overhead is per profile (answer 0.8k, patch/findings 1.4k, agent 4.5k) and absent for pull / copy", async () => {
    const { builder, t } = rich();
    const fixed = async (mode: "answer" | "findings" | "patch" | "agent" | "pull" | "copy") =>
      (
        await builder.build(
          bundleInput({
            mode,
            out:
              mode === "pull" || mode === "copy"
                ? "reply"
                : mode === "answer"
                  ? "answer/1"
                  : mode === "findings"
                    ? "findings/1"
                    : mode === "agent"
                      ? "agent/1"
                      : "patch/1",
            threads: [t],
            write: mode === "answer" || mode === "findings" ? [] : [FETCH],
          }),
          4000,
        )
      ).items.find((i) => i.key === "fixed")?.tokens;
    expect([await fixed("answer"), await fixed("findings"), await fixed("patch"), await fixed("agent"), await fixed("pull"), await fixed("copy")]).toEqual([
      800,
      1400,
      1400,
      4500,
      undefined,
      undefined,
    ]);
  });

  test.each([
    ["code:context", (t: string) => /^CODE internal\/meta\/fetch\.go:43-47 /mu.test(t)],
    ["rules", (t: string) => !tagsOf(t).includes("RULES")],
    ["thread", (t: string) => !/^THREAD /mu.test(t)],
    ["doc:neighbors", (t: string) => !/^> ~(?:prev|next)/mu.test(t)],
  ])("removing the %s chip leaves that part out from the start (and says nothing in OMITTED)", async (key, gone) => {
    const { builder, t } = rich();
    const b = await builder.build(bundleInput({ threads: [t], write: [FETCH], removed: [key] }), 12000);
    expect(gone(b.text)).toBe(true);
    expect(b.omitted).toEqual([]);
    expect(b.items.some((i) => i.key === key)).toBe(false);
  });

  test("removing a related chip drops just that entry; non-removable keys are ignored", async () => {
    const { builder, t } = rich();
    const full = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 12000);
    const rel = full.items.find((i) => i.kind === "related") as NonNullable<(typeof full.items)[number]>;
    const b = await builder.build(
      bundleInput({ threads: [t], write: [FETCH], removed: [rel.key, "ask", "write", "code:internal/meta/fetch.go:43-47"] }),
      12000,
    );
    expect(b.items.some((i) => i.key === rel.key)).toBe(false);
    expect(b.items.some((i) => i.key === "ask")).toBe(true);
    expect(b.text).toContain("ASK\n> Fetch の失敗時の挙動を変えたい");
    expect(b.text).toContain(`WRITE ${FETCH}`);
  });

  test("chips (extra ranges) add code; start = end = 0 only declares a file and adds no code", async () => {
    const { builder, t } = rich();
    const b = await builder.build(
      bundleInput({
        threads: [t],
        write: [FETCH, "x.go"],
        extra: [
          { path: "internal/store/store.go", start: 14, end: 24 },
          { path: "x.go", start: 0, end: 0 },
        ],
      }),
      12000,
    );
    expect(parse(b.text).data.some((l) => l.startsWith("CODE internal/store/store.go:"))).toBe(true);
    expect(parse(b.text).data.some((l) => l.includes("x.go"))).toBe(false);
    expect(b.items.some((i) => i.key === "code:internal/store/store.go:14-24")).toBe(true);
  });

  test("hints become read-only REL entries, first and last to go", async () => {
    const { builder, t } = rich();
    const b = await builder.build(bundleInput({ threads: [t], write: [FETCH], hints: [{ path: "internal/store/store.go", start: 43, end: 52 }] }), 12000);
    const data = parse(b.text).data;
    const i = data.indexOf("REL internal/store/store.go:43");
    expect(i).toBeGreaterThan(-1);
    expect(data[i + 1]?.startsWith("|")).toBe(true);
    expect(data.findIndex((l) => l.startsWith("REL "))).toBe(i); // hints come first
    expect(b.blobs["internal/store/store.go"]).toMatch(/^[0-9a-f]{40}$/u);
  });

  test("a hint with end before start still shows its start line (a REL block always has a code line); line 0 is ignored", async () => {
    const { builder, t } = rich();
    const hints = [
      { path: "internal/store/store.go", start: 43, end: 0 },
      { path: "internal/store/memory.go", start: 0, end: 0 },
    ];
    const b = await builder.build(bundleInput({ threads: [t], write: [FETCH], hints }), 12000);
    const data = checkGrammar(b.text).data;
    const i = data.indexOf("REL internal/store/store.go:43");
    expect(data[i + 1]?.startsWith("|")).toBe(true);
    expect(data.some((l) => l.startsWith("REL internal/store/memory.go:0"))).toBe(false);
  });

  test("metrics: loop.bundle.ms is observed once per build", async () => {
    const { w, t } = rich();
    const seen: number[] = [];
    let now = 100;
    const b = createBundleBuilder({
      ...w.deps,
      metrics: { inc: () => undefined, observe: (n, ms) => n === "loop.bundle.ms" && seen.push(ms) },
      clock: { now: () => (now += 7), iso: () => "" },
    });
    await b.build(bundleInput({ threads: [t], write: [FETCH] }), 4000);
    expect(seen).toEqual([7]);
  });
});
