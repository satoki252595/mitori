/**
 * CR-PENDING(WP-11) cr-requests/WP-11.md #1: the CLI's copies of loop / agent contract names must stay identical to
 * the originals. Both sides are checked against the same fixtures (the loop tests render them from the contract).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentLabelFromEnv, agentLabelOfClient, MCP_TOOL_NAMES, MCP_TOOLS_LIST_JSON, parseTouchHook } from "./loop-contract.ts";

const GOLDEN = join(import.meta.dir, "../../../../fixtures/golden");
const cases = JSON.parse(readFileSync(join(GOLDEN, "pull/hook-cases.json"), "utf8")) as {
  touch: { name: string; stdin: string; paths: string[] }[];
  label: { name: string; flag?: string; env: Record<string, string>; label: string }[];
};

describe("loop contract copies", () => {
  test("tools/list bytes == fixtures/golden/mcp/tools-list.json (rendered from loop MCP_TOOLS)", () => {
    expect(MCP_TOOLS_LIST_JSON).toBe(readFileSync(join(GOLDEN, "mcp/tools-list.json"), "utf8").trimEnd());
    expect(MCP_TOOL_NAMES.length).toBe(8);
  });

  for (const c of cases.touch) test(`parseTouchHook: ${c.name}`, () => expect(parseTouchHook(c.stdin)).toEqual(c.paths));
  for (const c of cases.label) test(`agentLabelFromEnv: ${c.name}`, () => expect(agentLabelFromEnv(c.flag, c.env)).toBe(c.label));

  test("MCP clientInfo.name → [a-z0-9-] label", () => {
    expect(agentLabelOfClient("Claude Code")).toBe("claude-code");
    expect(agentLabelOfClient("codex-mcp-client")).toBe("codex-mcp-client");
    expect(agentLabelOfClient("")).toBe("mcp");
    expect(agentLabelOfClient(undefined)).toBe("mcp");
  });
});
