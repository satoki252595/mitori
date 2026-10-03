/**
 * The byte-fixed MCP `tools/list` result (spec §10.8) rendered from the contract catalogue `MCP_TOOLS`: order, names,
 * descriptions and schemas as declared, plus the `readOnlyHint` annotation from `readOnly` (nothing more: every byte
 * is resident in each agent's context, budget `mcp.toolsTokens`). Any change here changes every agent's cache prefix,
 * so `fixtures/golden/mcp/tools-list.json` pins the bytes.
 */
import { MCP_TOOLS } from "../contract.ts";

/** One tool as listed to MCP clients. */
export interface McpToolListing {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
}

/** `tools/list` result object. */
export function mcpToolsList(): { tools: McpToolListing[] } {
  return {
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { readOnlyHint: t.readOnly },
    })),
  };
}

/** Minified JSON of {@link mcpToolsList} — the exact bytes the shim serves. */
export function mcpToolsListJson(): string {
  return JSON.stringify(mcpToolsList());
}
