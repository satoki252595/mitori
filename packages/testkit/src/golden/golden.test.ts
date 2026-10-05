import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expectGolden } from "@mitori/testkit/golden";
import { compareGolden, firstDifference, GOLDEN_DIR } from "./compare.ts";

// scratch goldens live under a directory that no fixture uses and is removed afterwards
const SCRATCH = "_testkit-selftest";
afterAll(() => rmSync(join(GOLDEN_DIR, SCRATCH), { recursive: true, force: true }));
const update = { MITORI_UPDATE_GOLDEN: "1" };

describe("TK-GOLDEN-01 expectGolden (testing spec §2.5)", () => {
  test("a missing golden fails with the way to create it; update mode writes it; the next comparison passes", () => {
    const rel = `${SCRATCH}/a.txt`;
    expect(() => compareGolden(rel, "hello\n", {}, {})).toThrow("MITORI_UPDATE_GOLDEN=1");
    compareGolden(rel, "hello\n", {}, update);
    expect(readFileSync(join(GOLDEN_DIR, rel), "utf8")).toBe("hello\n");
    expect(() => compareGolden(rel, "hello\n", {}, {})).not.toThrow();
  });

  test("a changed text fails with the first differing line, never silently rewrites", () => {
    const rel = `${SCRATCH}/b.txt`;
    compareGolden(rel, "one\ntwo\nthree\n", {}, update);
    expect(() => compareGolden(rel, "one\nTWO\nthree\n", {}, {})).toThrow(/first difference at line 2/);
    expect(readFileSync(join(GOLDEN_DIR, rel), "utf8")).toBe("one\ntwo\nthree\n");
  });

  test("objects are stored as canonical JSON: sorted keys, 2 spaces, trailing LF; key order in the input does not matter", () => {
    const rel = `${SCRATCH}/c.json`;
    compareGolden(rel, { b: 1, a: { z: [1, 2], y: "日本語" } }, {}, update);
    expect(readFileSync(join(GOLDEN_DIR, rel), "utf8")).toBe('{\n  "a": {\n    "y": "日本語",\n    "z": [\n      1,\n      2\n    ]\n  },\n  "b": 1\n}\n');
    expect(() => compareGolden(rel, { a: { y: "日本語", z: [1, 2] }, b: 1 }, {}, {})).not.toThrow();
    expect(() => compareGolden(rel, { a: { y: "日本語", z: [1, 3] }, b: 1 }, {}, {})).toThrow("differs");
  });

  test("`normalize` is applied to the actual text before it is compared or written", () => {
    const rel = `${SCRATCH}/d.txt`;
    const normalize = (t: string) => t.replaceAll(/\d{4}-\d\d-\d\d/g, "$DATE");
    compareGolden(rel, "run 2026-10-03 ok\n", { normalize }, update);
    expect(readFileSync(join(GOLDEN_DIR, rel), "utf8")).toBe("run $DATE ok\n");
    expect(() => compareGolden(rel, "run 2027-01-01 ok\n", { normalize }, {})).not.toThrow();
  });

  test("paths cannot leave fixtures/golden", () => {
    for (const bad of ["../x.txt", "/etc/hosts", `${SCRATCH}/../../x`]) expect(() => compareGolden(bad, "x", {}, update)).toThrow("escapes");
    expect(existsSync(join(GOLDEN_DIR, "..", "x.txt"))).toBe(false);
  });

  test.skipIf(process.env.MITORI_UPDATE_GOLDEN === "1")("the public function reads MITORI_UPDATE_GOLDEN from the process environment", () => {
    const rel = `${SCRATCH}/e.txt`;
    expect(() => expectGolden(rel, "x\n")).toThrow("does not exist");
  });

  test("firstDifference shows a window around the line and tolerates different lengths", () => {
    const d = firstDifference("a\nb\nc\nd\ne\n", "a\nb\nX\nd\n");
    expect(d).toContain("line 3");
    expect(d).toContain("--- expected");
    expect(d).toContain("c");
    expect(d).toContain("X");
    expect(firstDifference("a\n", "a\nb\n")).toContain("line 2");
  });
});
