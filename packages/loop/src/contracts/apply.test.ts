import { describe, expect, test } from "bun:test";
import { DEFAULT_DENY_GLOBS } from "@mitori/core";
import { blobOf, fakeAnchors, hasher } from "../bundle/test/fake-anchor.ts";
import type { ApplyEditsInput } from "../contract.ts";
import { applyEditsToText } from "./index.ts";

type E = ApplyEditsInput["edits"][number];

const lines = (n: number, prefix = "line"): string[] => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
const text = (ls: readonly string[], eol = "\n", final = true): string => ls.join(eol) + (final ? eol : "");

function run(current: string, edits: Partial<E>[], opts: { bundle?: string; deny?: string[]; scope?: string[]; path?: string } = {}) {
  const path = opts.path ?? "src/a.ts";
  const bundle = opts.bundle ?? current;
  const input: ApplyEditsInput = {
    current: { [path]: current },
    bundleText: { [path]: { blob: blobOf(bundle), text: bundle } },
    currentBlob: { [path]: blobOf(current) },
    edits: edits.map((e) => ({ path, start: 1, newText: "", firstLine: "", ...e }) as E),
    writeScope: opts.scope ?? [path],
    deny: opts.deny ?? [],
  };
  return applyEditsToText(input, fakeAnchors, hasher);
}

const out = (r: ReturnType<typeof run>, path = "src/a.ts"): string => r.files[path] as string;

describe("AC-L25 applyEditsToText — placement", () => {
  const base = text(lines(10));
  test("replace one line", () => {
    const r = run(base, [{ start: 3, end: 3, firstLine: "line 3", newText: "THREE" }]);
    expect(r.ok).toBe(true);
    expect(out(r)).toBe(text(["line 1", "line 2", "THREE", ...lines(10).slice(3)]));
  });
  test("replace a range with fewer / more lines", () => {
    expect(out(run(base, [{ start: 2, end: 4, firstLine: "line 2", newText: "X" }]))).toBe(text(["line 1", "X", ...lines(10).slice(4)]));
    expect(out(run(base, [{ start: 2, end: 2, firstLine: "line 2", newText: "X\nY\nZ" }]))).toBe(text(["line 1", "X", "Y", "Z", ...lines(10).slice(2)]));
  });
  test("delete lines with empty new_text", () => {
    expect(out(run(base, [{ start: 4, end: 5, firstLine: "line 4", newText: "" }]))).toBe(text([...lines(10).slice(0, 3), ...lines(10).slice(5)]));
  });
  test("insert before a line (end omitted, and end < start)", () => {
    const want = text(["line 1", "line 2", "NEW", ...lines(10).slice(2)]);
    expect(out(run(base, [{ start: 3, newText: "NEW" }]))).toBe(want);
    expect(out(run(base, [{ start: 3, end: 2, newText: "NEW" }]))).toBe(want);
  });
  test("insert at the very start and the very end", () => {
    expect(out(run(base, [{ start: 1, newText: "TOP" }]))).toBe(text(["TOP", ...lines(10)]));
    expect(out(run(base, [{ start: 11, newText: "BOTTOM" }]))).toBe(text([...lines(10), "BOTTOM"]));
  });
  test("a trailing newline in new_text adds no blank line, an explicit blank line stays", () => {
    expect(out(run(base, [{ start: 2, newText: "A\n" }]))).toBe(text(["line 1", "A", ...lines(10).slice(1)]));
    expect(out(run(base, [{ start: 2, newText: "A\n\n" }]))).toBe(text(["line 1", "A", "", ...lines(10).slice(1)]));
  });
  test("several edits in one file apply against the original coordinates (bottom-up)", () => {
    const r = run(base, [
      { start: 2, end: 2, firstLine: "line 2", newText: "two" },
      { start: 8, end: 9, firstLine: "line 8", newText: "eight-nine" },
      { start: 5, newText: "before five" },
    ]);
    expect(r.ok).toBe(true);
    expect(out(r)).toBe(text(["line 1", "two", "line 3", "line 4", "before five", "line 5", "line 6", "line 7", "eight-nine", "line 10"]));
  });
  test("inserts at the same point concatenate in output order, ahead of a replacement that starts there", () => {
    const r = run(base, [
      { start: 3, newText: "first" },
      { start: 3, newText: "second" },
      { start: 3, end: 3, firstLine: "line 3", newText: "replaced" },
    ]);
    expect(r.ok).toBe(true);
    expect(out(r)).toBe(text(["line 1", "line 2", "first", "second", "replaced", ...lines(10).slice(3)]));
  });
  test("adjacent replacements are fine", () => {
    const r = run(base, [
      { start: 2, end: 3, firstLine: "line 2", newText: "A" },
      { start: 4, end: 4, firstLine: "line 4", newText: "B" },
    ]);
    expect(out(r)).toBe(text(["line 1", "A", "B", ...lines(10).slice(4)]));
  });
});

describe("AC-L25 applyEditsToText — line endings", () => {
  test("CRLF files stay CRLF and new_text is converted", () => {
    const crlf = text(lines(4), "\r\n");
    const r = run(crlf, [{ start: 2, end: 2, firstLine: "line 2", newText: "A\nB" }]);
    expect(out(r)).toBe("line 1\r\nA\r\nB\r\nline 3\r\nline 4\r\n");
  });
  test("mixed endings: untouched lines keep their own, new lines take the dominant one", () => {
    const mixed = "a\r\nb\r\nc\nd\r\n";
    const r = run(mixed, [{ start: 3, end: 3, firstLine: "c", newText: "C" }]);
    expect(out(r)).toBe("a\r\nb\r\nC\r\nd\r\n");
    expect(out(run(mixed, [{ start: 1, end: 1, firstLine: "a", newText: "A" }]))).toBe("A\r\nb\r\nc\nd\r\n");
  });
  test("a file without a final newline keeps that property", () => {
    const noEol = text(lines(3), "\n", false);
    expect(out(run(noEol, [{ start: 3, end: 3, firstLine: "line 3", newText: "THREE" }]))).toBe("line 1\nline 2\nTHREE");
    expect(out(run(noEol, [{ start: 4, newText: "four" }]))).toBe("line 1\nline 2\nline 3\nfour");
    expect(out(run(noEol, [{ start: 1, newText: "zero" }]))).toBe("zero\nline 1\nline 2\nline 3");
  });
  test("an empty file takes inserted lines with a final newline", () => {
    expect(out(run("", [{ start: 1, newText: "x" }]))).toBe("x\n");
  });
});

describe("AC-L25 applyEditsToText — first_line check", () => {
  const base = text(lines(12));
  test("first_line is compared after whitespace normalisation", () => {
    const r = run(base, [{ start: 3, end: 3, firstLine: "  line    3 ", newText: "X" }]);
    expect(r.ok).toBe(true);
    expect(r.shifted).toEqual([]);
  });
  test.each([-3, -2, -1, 1, 2, 3])("absorbs a miscount of %i lines when exactly one nearby line matches", (d) => {
    const r = run(base, [{ start: 6, end: 6, firstLine: `line ${6 + d}`, newText: "X" }]);
    expect(r.ok).toBe(true);
    expect(r.shifted).toEqual([{ edit: 0, delta: d }]);
    expect(out(r).split("\n")[6 + d - 1]).toBe("X");
    expect(r.stamped[0]?.start).toBe(6 + d);
  });
  test("shifts the whole range, not just the first line", () => {
    const r = run(base, [{ start: 4, end: 6, firstLine: "line 5", newText: "X" }]);
    expect(r.ok).toBe(true);
    expect(out(r)).toBe(text(["line 1", "line 2", "line 3", "line 4", "X", ...lines(12).slice(7)]));
  });
  test("does not look further than 3 lines", () => {
    const r = run(base, [{ start: 2, end: 2, firstLine: "line 7", newText: "X" }]);
    expect(r.ok).toBe(false);
    expect(r.problems[0]?.code).toBe("E_PATCH_RANGE");
  });
  test("ambiguous matches (the same text 1 and 2 lines away) are refused", () => {
    const dup = text(["a", "x", "y", "x", "b", "c", "d"]);
    const r = run(dup, [{ start: 3, end: 3, firstLine: "x", newText: "X" }]);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatchObject({ edit: 0, code: "E_PATCH_RANGE" });
    expect(r.files).toEqual({});
  });
  test("a shifted range that would leave the file is refused", () => {
    const r = run(text(lines(3)), [{ start: 3, end: 3, firstLine: "line 2", newText: "X" }]);
    // line 2 is one above: delta -1 is fine and unique
    expect(r.ok).toBe(true);
    const r2 = run(text(lines(3)), [{ start: 2, end: 3, firstLine: "line 3", newText: "X" }]);
    expect(r2.ok).toBe(false);
  });
  test("inserts are not checked against first_line", () => {
    expect(run(base, [{ start: 5, firstLine: "", newText: "N" }]).ok).toBe(true);
    expect(run(base, [{ start: 5, firstLine: "whatever", newText: "N" }]).ok).toBe(true);
  });
});

describe("AC-L25 applyEditsToText — expect stamping", () => {
  const base = text(lines(6));
  test("expect = xxh3 of the normalised current snippet; insert = xxh3 of empty", () => {
    const r = run(base, [
      { start: 2, end: 3, firstLine: "line 2", newText: "X" },
      { start: 5, newText: "I" },
    ]);
    expect(r.stamped[0]?.expect).toBe(hasher.xxh3("line 2\nline 3"));
    expect(r.stamped[1]?.expect).toBe(hasher.xxh3(""));
    expect(r.stamped[1]?.end).toBeUndefined();
    expect(r.stamped[0]).toMatchObject({ path: "src/a.ts", start: 2, end: 3, newText: "X", firstLine: "line 2" });
  });
  test("stamped keeps the input order", () => {
    const r = run(base, [
      { start: 5, newText: "I" },
      { start: 1, end: 1, firstLine: "line 1", newText: "X" },
    ]);
    expect(r.stamped.map((e) => e.start)).toEqual([5, 1]);
  });
});

describe("AC-L25 applyEditsToText — atomicity and refusals", () => {
  const base = text(lines(10));
  const good: Partial<E> = { start: 2, end: 2, firstLine: "line 2", newText: "ok" };

  test("one bad edit means no file changes at all", () => {
    const r = run(base, [good, { start: 9, end: 9, firstLine: "nope", newText: "bad" }]);
    expect(r.ok).toBe(false);
    expect(r.files).toEqual({});
    expect(r.stamped).toEqual([]);
    expect(r.problems.map((p) => p.edit)).toEqual([1]);
  });
  test("every problem is reported, not only the first", () => {
    const r = run(base, [
      { start: 2, end: 2, firstLine: "zzz", newText: "a" },
      { start: 8, end: 8, firstLine: "yyy", newText: "b" },
    ]);
    expect(r.problems.map((p) => p.edit)).toEqual([0, 1]);
  });
  test("out-of-range replacement and insertion", () => {
    expect(run(base, [{ start: 9, end: 11, firstLine: "line 9", newText: "x" }]).problems[0]?.code).toBe("E_PATCH_RANGE");
    expect(run(base, [{ start: 12, newText: "x" }]).problems[0]?.code).toBe("E_PATCH_RANGE");
    expect(run(base, [{ start: 0, newText: "x" }]).problems[0]?.code).toBe("E_PATCH_RANGE");
  });
  test("overlapping replacements", () => {
    const r = run(base, [
      { start: 2, end: 4, firstLine: "line 2", newText: "a" },
      { start: 4, end: 5, firstLine: "line 4", newText: "b" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatchObject({ edit: 1, code: "E_PATCH_APPLY" });
  });
  test("an insertion strictly inside a replaced range", () => {
    const r = run(base, [
      { start: 2, end: 5, firstLine: "line 2", newText: "a" },
      { start: 4, newText: "b" },
    ]);
    expect(r.problems[0]?.code).toBe("E_PATCH_APPLY");
    // …but right before the range, or right after it, is fine
    expect(
      run(base, [
        { start: 2, end: 5, firstLine: "line 2", newText: "a" },
        { start: 2, newText: "b" },
      ]).ok,
    ).toBe(true);
    expect(
      run(base, [
        { start: 2, end: 5, firstLine: "line 2", newText: "a" },
        { start: 6, newText: "b" },
      ]).ok,
    ).toBe(true);
  });
  test("paths outside the write scope, on a deny glob, or missing are refused with their own codes", () => {
    expect(run(base, [{ ...good, path: "src/b.ts" }], { scope: ["src/a.ts"] }).problems[0]?.code).toBe("E_SCOPE_VIOLATION");
    expect(run(base, [good], { deny: ["src/**"] }).problems[0]?.code).toBe("E_DENY_GLOB");
    const input: ApplyEditsInput = {
      current: {},
      bundleText: {},
      currentBlob: {},
      edits: [{ path: "new.ts", start: 1, newText: "x", firstLine: "" }],
      writeScope: ["new.ts"],
      deny: [],
    };
    expect(applyEditsToText(input, fakeAnchors, hasher).problems[0]?.code).toBe("E_PATCH_APPLY");
  });
  test("a deny glob reaches into dot-directories", () => {
    const r = run(base, [good], { deny: [".github/workflows/**"], path: ".github/workflows/ci.yml" });
    expect(r.problems[0]?.code).toBe("E_DENY_GLOB");
  });
  test("WP30-A: edits to readable agent docs are refused (write side unchanged)", () => {
    for (const path of [".claude/skills/scrape/SKILL.md", ".agents/skills/apply/SKILL.md", ".agents/skills/x/cli/src/a.ts"]) {
      const r = run(base, [{ ...good, path }], { deny: [...DEFAULT_DENY_GLOBS], path, scope: [path] });
      expect(r.problems[0]?.code).toBe("E_DENY_GLOB");
    }
  });
  test("an edit whose base is a different blob than the one shown is refused", () => {
    const r = run(base, [{ ...good, base: "deadbee" }]);
    expect(r.problems[0]?.code).toBe("E_PATCH_RANGE");
    expect(run(base, [{ ...good, base: blobOf(base).slice(0, 7) }]).ok).toBe(true);
  });
  test("no edits is a no-op success", () => {
    expect(run(base, [])).toMatchObject({ ok: true, files: {}, stamped: [] });
  });
  test("two files: both written or neither", () => {
    const a = text(lines(5, "a"));
    const b = text(lines(5, "b"));
    const mk = (second: Partial<E>) =>
      applyEditsToText(
        {
          current: { "a.ts": a, "b.ts": b },
          bundleText: { "a.ts": { blob: blobOf(a), text: a }, "b.ts": { blob: blobOf(b), text: b } },
          currentBlob: { "a.ts": blobOf(a), "b.ts": blobOf(b) },
          edits: [
            { path: "a.ts", start: 1, end: 1, firstLine: "a 1", newText: "A" },
            { path: "b.ts", start: 1, end: 1, firstLine: "b 1", newText: "B", ...second },
          ],
          writeScope: ["a.ts", "b.ts"],
          deny: [],
        },
        fakeAnchors,
        hasher,
      );
    expect(Object.keys(mk({}).files).sort()).toEqual(["a.ts", "b.ts"]);
    const bad = mk({ firstLine: "zzz" });
    expect(bad.ok).toBe(false);
    expect(bad.files).toEqual({});
  });
});

describe("AC-L26 applyEditsToText — the file changed since the bundle", () => {
  const shown = text(lines(20));
  const edit = { start: 10, end: 11, firstLine: "line 10", newText: "X\nY" };

  test("same blob: coordinates are used as they are", () => {
    expect(run(shown, [edit]).ok).toBe(true);
  });
  test("lines were inserted above: the edit is mapped down", () => {
    const now = text(["new a", "new b", ...lines(20)]);
    const r = run(now, [edit], { bundle: shown });
    expect(r.ok).toBe(true);
    expect(r.stamped[0]).toMatchObject({ start: 12, end: 13 });
    expect(out(r)).toBe(text(["new a", "new b", ...lines(20).slice(0, 9), "X", "Y", ...lines(20).slice(11)]));
  });
  test("lines were removed above: the edit is mapped up", () => {
    const now = text(lines(20).slice(3));
    const r = run(now, [edit], { bundle: shown });
    expect(r.ok).toBe(true);
    expect(r.stamped[0]).toMatchObject({ start: 7, end: 8 });
  });
  test("a formatter reflowed the target lines: E_PATCH_RANGE, nothing written", () => {
    const now = text(lines(20).map((l) => (l === "line 10" ? "line TEN" : l)));
    const r = run(now, [edit], { bundle: shown });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatchObject({ edit: 0, code: "E_PATCH_RANGE" });
    expect(r.files).toEqual({});
  });
  test("a line was inserted inside the edited range: refused", () => {
    const now = text([...lines(20).slice(0, 10), "intruder", ...lines(20).slice(10)]);
    expect(run(now, [edit], { bundle: shown }).problems[0]?.code).toBe("E_PATCH_RANGE");
  });
  test("a change elsewhere in the file does not matter", () => {
    const now = text(lines(20).map((l) => (l === "line 3" ? "changed 3" : l)));
    expect(run(now, [edit], { bundle: shown }).ok).toBe(true);
  });
  test("inserts map by the line they precede, and appends by the last line", () => {
    const now = text(["top", ...lines(20)]);
    expect(run(now, [{ start: 5, newText: "I" }], { bundle: shown }).stamped[0]?.start).toBe(6);
    expect(run(now, [{ start: 21, newText: "I" }], { bundle: shown }).stamped[0]?.start).toBe(22);
  });
  test("the first_line search still applies after mapping", () => {
    const now = text(["top", ...lines(20)]);
    const r = run(now, [{ start: 11, end: 11, firstLine: "line 10", newText: "X" }], { bundle: shown });
    // shown line 11 maps to 12; its text is "line 11", first_line says "line 10" → one line up
    expect(r.ok).toBe(true);
    expect(r.shifted).toEqual([{ edit: 0, delta: -1 }]);
  });
});
