/**
 * Pull helpers (loop spec §10, §10.6): hook payload → absolute paths, agent label precedence. The cases are shared
 * with the CLI's copy (`fixtures/golden/pull/hook-cases.json`, CR-PENDING(WP-11) until the CLI may import loop).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOUCH_LIMITS } from "../contract.ts";
import { normalizeAbs } from "./hook.ts";
import { agentLabelFromEnv, parseTouchHook } from "./index.ts";

interface Cases {
  touch: { name: string; stdin: string; paths: string[] }[];
  label: { name: string; flag?: string; env: Record<string, string>; label: string }[];
}
const CASES = JSON.parse(readFileSync(join(import.meta.dir, "../../../../fixtures/golden/pull/hook-cases.json"), "utf8")) as Cases;

describe("AC-L74 parseTouchHook (PostToolUse payload → absolute paths)", () => {
  for (const c of CASES.touch) test(c.name, () => expect(parseTouchHook(c.stdin)).toEqual(c.paths));

  test("never throws, whatever the bytes", () => {
    for (const s of ["{", "null", "1", '"x"', "{}", '{"tool_input":null}', '{"tool_input":[]}', "\u0000", '{"tool_input":{"file_path":"\\ud800"}}'])
      expect(() => parseTouchHook(s)).not.toThrow();
  });

  test("payloads over the stdin cap are ignored", () => {
    const big = JSON.stringify({ tool_input: { file_path: "/r/a" }, pad: "x".repeat(TOUCH_LIMITS.maxStdinBytes) });
    expect(parseTouchHook(big)).toEqual([]);
  });

  test("normalizeAbs is lexical and refuses relative paths", () => {
    expect(normalizeAbs("/a/b/../../../c")).toBe("/c");
    expect(normalizeAbs("/a/./b/")).toBe("/a/b");
    expect(normalizeAbs("a/b")).toBeNull();
  });
});

describe("agentLabelFromEnv (spec §10 label precedence)", () => {
  for (const c of CASES.label) test(c.name, () => expect(agentLabelFromEnv(c.flag, c.env)).toBe(c.label));
});
