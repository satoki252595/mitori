/**
 * Minimal MCP server over newline-delimited JSON-RPC 2.0 on stdio (spec §10.8). Hand-written instead of the SDK: the
 * shim must answer `initialize` in ≤ 60 ms (`mcp.init`) and the SDK would pull express/hono into the binary.
 * `initialize` (2025 revisions) and `server/discover` (2026 revisions) are answered without the daemon; `tools/list`
 * is the byte-fixed catalogue; every `tools/call` goes to {@link ToolRunner} and comes back as text only (errors are
 * `isError: true` results, never protocol errors).
 */
import { MCP_INSTRUCTIONS, MCP_TOOLS_LIST_JSON } from "../loop-contract.ts";

/** Protocol revisions this shim speaks, newest first. */
export const PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const LATEST_2025 = "2025-11-25";

/** Runs one tool; resolves with the text result (or an error text with `isError`). */
export type ToolRunner = (
  name: string,
  args: Record<string, unknown>,
  ctx: { client: string; signal: AbortSignal },
) => Promise<{ text: string; isError?: boolean }>;

type Id = string | number | null;
interface Msg {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: Record<string, unknown>;
}

const reply = (id: Id, result: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result });
const failure = (id: Id, code: number, message: string) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

/** One MCP session: feed it lines, it writes response lines. */
export function createMcpSession(opts: { version: string; write: (line: string) => void; run: ToolRunner }) {
  let client = "mcp";
  const inflight = new Map<Id, AbortController>();
  const pending = new Set<Promise<void>>();

  const serverInfo = { name: "mitori", version: opts.version };
  const init = (requested: unknown) => {
    const v = typeof requested === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_2025;
    return { protocolVersion: v, capabilities: { tools: {} }, serverInfo, instructions: MCP_INSTRUCTIONS };
  };

  async function call(id: Id, params: Record<string, unknown>): Promise<string> {
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments !== null && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};
    const ac = new AbortController();
    inflight.set(id, ac);
    try {
      const r = await opts.run(name, args, { client, signal: ac.signal });
      return reply(id, { content: [{ type: "text", text: r.text }], ...(r.isError ? { isError: true } : {}) });
    } catch (e) {
      return reply(id, { content: [{ type: "text", text: `error E_INTERNAL: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
    } finally {
      inflight.delete(id);
    }
  }

  /** Answer one message (null for notifications). */
  function handle(m: Msg): string | Promise<string> | null {
    const id = m.id ?? null;
    const notification = m.id === undefined;
    const params = m.params ?? {};
    switch (m.method) {
      case "initialize": {
        const info = params.clientInfo as { name?: unknown } | undefined;
        if (typeof info?.name === "string") client = info.name;
        return reply(id, init(params.protocolVersion));
      }
      case "server/discover":
        return reply(id, { supportedVersions: PROTOCOL_VERSIONS, capabilities: { tools: {} }, serverInfo, instructions: MCP_INSTRUCTIONS });
      case "ping":
        return notification ? null : reply(id, {});
      case "tools/list":
        // the catalogue bytes are spliced in verbatim: a re-serialization could reorder nothing, but this is the contract
        return `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":${MCP_TOOLS_LIST_JSON}}`;
      case "tools/call":
        return call(id, params);
      case "notifications/cancelled":
        inflight.get((params.requestId ?? null) as Id)?.abort();
        return null;
      default:
        return notification ? null : failure(id, -32601, `method not found: ${String(m.method)}`);
    }
  }

  return {
    /** Feed one input line. */
    line(text: string): void {
      if (text.trim() === "") return;
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch {
        opts.write(failure(null, -32700, "parse error"));
        return;
      }
      const batch = Array.isArray(msg);
      const items = (batch ? msg : [msg]) as Msg[];
      const outs = items.map((m) => (m !== null && typeof m === "object" && m.jsonrpc === "2.0" ? handle(m) : failure(null, -32600, "invalid request")));
      const done = Promise.all(outs).then((all) => {
        const lines = all.filter((x): x is string => x !== null);
        if (lines.length === 0) return;
        opts.write(batch ? `[${lines.join(",")}]` : (lines[0] as string));
      });
      pending.add(done);
      void done.finally(() => pending.delete(done));
    },
    /** Resolves when every call already started has answered. */
    async drain(): Promise<void> {
      while (pending.size > 0) await Promise.all([...pending]);
    },
    get client() {
      return client;
    },
  };
}
