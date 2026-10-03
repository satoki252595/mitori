import { describe, expect, test } from "bun:test";
import { addedLines, applySelected, changeRanges, diffLines, fileDiff, rawHunks, splitKeep } from "./diff.ts";

/** Deterministic pseudo-random line soup. */
function soup(seed: number, n: number): string {
  let s = seed;
  const next = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s;
  };
  const words = ["a", "b", "c", "d", "}", "", "\treturn x", "if err != nil {"];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(words[next() % words.length] as string);
  return `${out.join(next() % 5 === 0 ? "\r\n" : "\n")}${next() % 3 === 0 ? "" : "\n"}`;
}

function mutate(text: string, seed: number): string {
  const lines = splitKeep(text);
  let s = seed;
  const next = () => {
    s = (Math.imul(s, 22695477) + 1) >>> 0;
    return s;
  };
  const edits = 1 + (next() % 6);
  for (let e = 0; e < edits; e++) {
    const at = lines.length === 0 ? 0 : next() % lines.length;
    const kind = next() % 3;
    if (kind === 0) lines.splice(at, 1);
    else if (kind === 1) lines.splice(at, 0, `new ${next() % 100}\n`);
    else lines[at] = `changed ${next() % 100}\n`;
  }
  return lines.join("");
}

describe("GIT-D exact line diff", () => {
  test("edit scripts reconstruct both sides (200 random pairs, CRLF and missing final newline included)", () => {
    for (let i = 1; i <= 200; i++) {
      const a = soup(i, 1 + (i % 40));
      const b = mutate(a, i * 7);
      const al = splitKeep(a);
      const bl = splitKeep(b);
      const ops = diffLines(al, bl);
      expect(
        ops
          .filter((o) => o.t !== "+")
          .map((o) => al[o.a])
          .join(""),
      ).toBe(a);
      expect(
        ops
          .filter((o) => o.t !== "-")
          .map((o) => bl[o.b])
          .join(""),
      ).toBe(b);
      // all hunks ⇒ new text, no hunk ⇒ old text
      const ids = new Set(rawHunks("f", a, b).map((h) => h.hunk.id));
      expect(applySelected("f", a, b, ids)).toBe(b);
      expect(applySelected("f", a, b, new Set())).toBe(a);
    }
  });

  test("minimal: one replaced line gives one hunk with 3 lines of context and unified numbering", () => {
    const a = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
    const b = "1\n2\n3\n4\nfive\n6\n7\n8\n9\n10\n";
    const [h, ...rest] = rawHunks("x.go", a, b);
    expect(rest).toEqual([]);
    expect(h?.hunk).toEqual({ id: "x.go:2", oldStart: 2, oldLines: 7, newStart: 2, newLines: 7, lines: [" 2", " 3", " 4", "-5", "+five", " 6", " 7", " 8"] });
  });

  test("distant changes are separate hunks; a subset applies byte-exactly", () => {
    const a = `${Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join("\n")}\n`;
    const b = a.replace("l3\n", "L3\n").replace("l25\n", "L25\nextra\n");
    const hs = rawHunks("a.ts", a, b);
    expect(hs.map((h) => h.hunk.id)).toEqual(["a.ts:1", "a.ts:22"]);
    expect(applySelected("a.ts", a, b, new Set(["a.ts:22"]))).toBe(a.replace("l25\n", "L25\nextra\n"));
  });

  test("new and deleted files; CRLF ↔ LF is a change; added lines for the secret scan", () => {
    expect(fileDiff("n.txt", null, "x\ny\n")).toMatchObject({
      status: "added",
      additions: 2,
      deletions: 0,
      hunks: [{ id: "n.txt:0", oldStart: 0, oldLines: 0 }],
    });
    expect(fileDiff("d.txt", "x\n", null)).toMatchObject({ status: "deleted", additions: 0, deletions: 1 });
    expect(fileDiff("c.txt", "a\r\nb\r\n", "a\nb\r\n").hunks[0]?.lines).toEqual(["-a", "+a", " b"]);
    expect(addedLines("a\nb\n", "a\nKEY=1\nb\nc")).toEqual([
      { line: 2, text: "KEY=1" },
      { line: 4, text: "c" },
    ]);
    expect(changeRanges("a\nb\nc\n", "a\nB\nc\n")).toEqual([{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 }]);
  });
});
