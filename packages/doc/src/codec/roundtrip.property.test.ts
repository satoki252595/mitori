// DOC-G-001 as a property (O8): whatever md a block holds — as the store keeps it (outer blank lines and trailing
// whitespace trimmed, open fences closed) — serialize → parse with the sidecar kinds gives every block back, byte
// for byte, under its own id. Seeded generator over the Markdown constructs that interact with ID comments: fences,
// indented code, setext underlines / rules, quotes, lists, tables, hard breaks, ID-like text.
import { describe, expect, test } from "bun:test";
import type { Block, BlockId, BlockKind } from "@mitori/core";
import type { CodecContext } from "../contract.ts";
import { seededRandom } from "../test/helpers.ts";
import { closeOpenFence } from "./blocks.ts";
import { parseDoc, reinterpret, serializeDoc } from "./parse.ts";

const ctx: CodecContext = { lang: "ja", docFile: "doc/01-what-why.md", docDirAbs: "/r/.mitori", rootAbs: "/r" };
const WORDS = [
  "日本語",
  "English",
  "  ",
  "\t",
  "trailing  \nnext",
  "\n\n\n",
  "    four",
  "\\",
  "~~~",
  "***",
  "---",
  "1)",
  "+ plus",
  "`code`",
  "**太字**",
  "_em_",
  "[link](../a.md)",
  "（[a.ts:1-3](../../src/a.ts#L1-L3)）",
  "x > y",
  "a | b",
  "#hash",
  "1.",
  "- not",
  "> q",
  "<b>",
  "&amp;",
  "ID b_aaaaaaaa",
];
const KINDS: BlockKind[] = [
  "heading",
  "prose",
  "list",
  "table",
  "facts",
  "code",
  "diagram",
  "learn",
  "recap",
  "pitfall",
  "deepdive",
  "why",
  "question",
  "faq",
  "placeholder",
];

function generator(seed: number) {
  const r = seededRandom(seed);
  const rnd = (n: number) => Math.floor(((r.bytes(1)[0] as number) / 256) * n);
  const pick = <T>(xs: readonly T[]): T => xs[rnd(xs.length)] as T;
  const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ");
  const line = () => Array.from({ length: 1 + rnd(5) }, () => pick(WORDS)).join(pick([" ", "", "、"]));
  const para = () => Array.from({ length: 1 + rnd(2) }, line).join("\n");
  const fence = (lang: string) =>
    `\`\`\`${lang}\n${Array.from({ length: 1 + rnd(3) }, () => pick(["const x = 1;", "", "  indented", "> not quote", "<!-- b_bbbbbbbb -->", "| a |"])).join("\n")}\n\`\`\``;
  const list = () => Array.from({ length: 1 + rnd(3) }, () => `${pick(["- ", "1. "])}${line()}${rnd(3) === 0 ? `\n  - ${line()}` : ""}`).join("\n");
  const table = () => `| a | b |\n|---|---|\n${Array.from({ length: 1 + rnd(3) }, () => `| ${oneLine(line()).replace(/\|/g, "\\|")} | x |`).join("\n")}`;
  const prose = () => Array.from({ length: 1 + rnd(3) }, () => pick([para, para, list, () => fence("ts")])()).join("\n\n");
  const md = (kind: BlockKind): string => {
    switch (kind) {
      case "heading":
        return `${pick(["#", "##", "###"])} ${oneLine(line())}x`;
      case "list":
        return list();
      case "table":
        return table();
      case "facts":
        return pick([list, table])();
      case "code":
        return fence(pick(["ts", "py", "", "sh"]));
      case "diagram":
        return `${rnd(2) ? `${line()}\n\n` : ""}\`\`\`mermaid\nflowchart LR\n  a["A"] --> b["B"]\n\`\`\``;
      case "question":
        return `問い ${oneLine(line())}`;
      case "why":
        return `**題**\n${prose()}`;
      default:
        return prose();
    }
  };
  return () =>
    Array.from({ length: 1 + rnd(6) }, (_, i) => {
      const kind = pick(KINDS);
      const text = closeOpenFence(
        md(kind)
          .replace(/^\s*\n/, "")
          .replace(/\s+$/, ""),
      );
      return { id: `b_${"abcdefgh"[i]}aaaaaaa` as BlockId, kind, md: text || "x" } as Block;
    });
}

describe("DOC-G-001 property: serialize → parse is the identity for every block the store can hold", () => {
  test("2,000 seeded documents", () => {
    const next = generator(7);
    const bad: unknown[] = [];
    for (let i = 0; i < 2000 && bad.length < 3; i++) {
      const blocks = next();
      const text = serializeDoc(blocks, ctx);
      const kinds = new Map(blocks.map((b) => [b.id, b.kind]));
      const parsed = parseDoc(text, "f.md", ctx, (id) => kinds.get(id));
      const got = parsed.blocks.map((p) => ({ id: p.id, md: p.id ? reinterpret(p.md, p.kindHint, kinds.get(p.id) as BlockKind, "ja") : p.md }));
      const want = blocks.map((b) => ({ id: b.id, md: b.md }));
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ blocks: blocks.map((b) => [b.kind, b.md]), got });
    }
    expect(bad).toEqual([]);
  });
});
