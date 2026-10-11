/**
 * AC-L76 MCP catalogue: the `tools/list` bytes are pinned (`fixtures/golden/mcp/tools-list.json`, served verbatim by
 * the CLI shim) and the resident cost stays in budget (`mcp.toolsTokens` 1,900 / 2,000 tokens incl. instructions).
 */
import { describe, expect, test } from "bun:test";
import { estimateTokensRaw } from "@mitori/indexer";
import { expectGolden } from "@mitori/testkit/golden";
import { MCP_INSTRUCTIONS, MCP_LIMITS, MCP_TOOLS } from "../contract.ts";
import { mcpToolsList, mcpToolsListJson } from "./tools.ts";

describe("AC-L76 MCP tools/list", () => {
  test("golden: byte-fixed tools/list result", () => {
    expectGolden("mcp/tools-list.json", `${mcpToolsListJson()}\n`);
  });

  test("8 tools in contract order; schemas forbid extra properties; thread ids are validated", () => {
    const { tools } = mcpToolsList();
    expect(tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(tools.length).toBe(8);
    for (const t of tools) expect((t.inputSchema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    expect(tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name)).toEqual([
      "mitori_status",
      "mitori_list_threads",
      "mitori_get_bundle",
      "mitori_get_doc",
      "mitori_find_symbol",
    ]);
  });

  test("mcp.toolsTokens: tools/list + instructions ≤ 1,900 tokens (limit 2,000)", () => {
    const tokens = estimateTokensRaw(mcpToolsListJson(), "json", "claude-v5") + estimateTokensRaw(MCP_INSTRUCTIONS, "markdown_en", "claude-v5");
    expect(tokens).toBeLessThanOrEqual(1900);
    expect(tokens).toBeLessThanOrEqual(MCP_LIMITS.toolsTokenBudget);
  });
});
