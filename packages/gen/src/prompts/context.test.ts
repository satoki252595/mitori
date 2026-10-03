import { describe, expect, test } from "bun:test";
import type { Fact } from "@mitori/core";
import { CITE_GAP_LINES, CitableBuilder } from "./context.ts";
import { testsWithLocations } from "./inputs.ts";

// daemon.go as the crit prompt showed it (dogfood 2026-10-04): three signatures, bodies elided; the symbols end before
// the next one's doc comment, so 277–278 and 294–296 are unseen lines BETWEEN shown symbols.
const SHOWN = [
  "=== internal/daemon/daemon.go · go · 1177 lines ===",
  "266|func WriteSessionFile(key string) error {",
  "⋮",
  "279|func ReadSessionFile(key string) {",
  "⋮",
  "297|func RemoveSessionFile(key string) {",
  "⋮",
  "=== a.js · javascript · 400 lines ===",
  "10|function a() {",
  "⋮",
  "21|const b = 1;",
  "=== b.js · javascript · 400 lines ===",
  "10|function a() {",
  "⋮",
  "22|const b = 1;",
  "> T a.test.js:12 a works",
];
const SYMBOLS: Record<string, { start: number; end: number }[]> = {
  "internal/daemon/daemon.go": [
    { start: 266, end: 276 },
    { start: 279, end: 293 },
    { start: 297, end: 307 },
  ],
  "a.js": [{ start: 10, end: 14 }],
  "b.js": [{ start: 10, end: 14 }],
};
const citable = new CitableBuilder().add(SHOWN).build({ fileLines: () => 2000, symbolRanges: (p) => SYMBOLS[p] ?? [] });

describe("GEN-U-061 V17 citable ranges (short unseen runs between shown lines)", () => {
  test("a range across three shown functions with doc-comment gaps is grounded", () => {
    expect(citable.allows("internal/daemon/daemon.go", 266, 297)).toBe(true);
    expect(citable.allows("internal/daemon/daemon.go", 266, 307)).toBe(true);
  });

  test("an unseen run longer than CITE_GAP_LINES, an uncovered end and an unseen file are not", () => {
    expect(CITE_GAP_LINES).toBe(6);
    expect(citable.allows("a.js", 10, 21)).toBe(true); // 15–20: a run of exactly CITE_GAP_LINES
    expect(citable.allows("b.js", 10, 22)).toBe(false); // 15–21: one line longer
    expect(citable.allows("a.js", 10, 30)).toBe(false); // the end is not within the 2-line slack of a shown line
    expect(citable.allows("internal/daemon/daemon.go", 308, 320)).toBe(false);
    expect(citable.allows("cmd/crit/cli_dispatch.go", 57, 60)).toBe(false);
  });

  test("a test location in a `> ` line is citable as that line (TESTS carry path:line)", () => {
    expect(citable.allows("a.test.js", 12, 12)).toBe(true);
    expect(citable.allows("a.test.js", 12, 40)).toBe(false);
  });

  test("TESTS lines get each case's line from the test facts (same names in order; unknown cases unchanged)", () => {
    const fact = (path: string, name: string, line: number): Fact => ({ kind: "test", detector: "test.go@1", path, line, blob: "b", name });
    const facts = [fact("x_test.go", "TestA", 10), fact("web/a.test.js", "dup", 3), fact("web/a.test.js", "dup", 9)];
    expect(testsWithLocations("T x_test.go: TestA\nT web/a.test.js: dup\nT web/a.test.js: dup\nT y_test.go: TestB\n\n", facts)).toEqual([
      "T x_test.go:10 TestA",
      "T web/a.test.js:3 dup",
      "T web/a.test.js:9 dup",
      "T y_test.go: TestB",
    ]);
  });
});
