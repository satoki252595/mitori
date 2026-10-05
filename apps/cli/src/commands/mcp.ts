/**
 * `mitori mcp` — the opt-in stdio MCP server (loop spec §10.8, AC-L76). `initialize` / `tools/list` are answered at
 * once without the daemon; the first `tools/call` starts the daemon if needed (≤ 5 s) and opens the workspace of the
 * cwd. Calls carry `x-mitori-client: mcp/<ver>` and `x-mitori-agent: <clientInfo.name as [a-z0-9-]>`. A daemon that
 * restarted (new token) is re-discovered once per failing call.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { ApiClient } from "@mitori/client";
import { MitoriError, type WorkspaceKey } from "@mitori/core";
import { parse } from "./args.ts";
import { apiOf, ensureDaemon } from "./daemon-client.ts";
import { type Io, usage } from "./io.ts";
import { agentLabelOfClient } from "./loop-contract.ts";
import { createMcpSession } from "./mcp/protocol.ts";
import { runTool, type ToolEnv } from "./mcp/tools.ts";
import { homeOf } from "./session.ts";
import { openWorkspace, real } from "./workspace.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(io.argv, { repo: { type: "string" } }, "mcp");
  if (positionals.length > 0) throw usage("mitori mcp accepts only --repo <path>", "mitori mcp --help");
  if (values.repo !== undefined) {
    const cwd = real(resolve(io.cwd, values.repo));
    try {
      if (!values.repo.trim() || !statSync(cwd).isDirectory()) throw new Error("not a directory");
    } catch {
      throw usage("--repo must name an existing directory", "mitori mcp --help");
    }
    io = { ...io, cwd };
  }
  let bound: Promise<{ api: ApiClient; ws: WorkspaceKey }> | null = null;
  const connect = async (client: string) => {
    const d = await ensureDaemon(io, homeOf(io));
    const api = apiOf(io, d, { kind: "mcp", agent: agentLabelOfClient(client) });
    return { api, ws: (await openWorkspace(io, api)).info.key };
  };
  const env: ToolEnv = {
    async workspace(client) {
      bound ??= connect(client);
      try {
        return await bound;
      } catch (e) {
        bound = null;
        throw e;
      }
    },
    random: io.random,
    sleep,
    now: () => io.clock.now(),
  };
  const session = createMcpSession({
    version: io.version,
    write: (line) => io.out(`${line}\n`),
    run: async (name, args, ctx) => {
      const first = await runTool(env, name, args, ctx);
      // the daemon may have restarted since the session bound to it (token rotated / port changed): rebind once
      if (first.isError && /^error (E_AUTH_REQUIRED|E_NOT_READY)\b/.test(first.text)) {
        bound = null;
        return runTool(env, name, args, ctx);
      }
      return first;
    },
  });
  try {
    for await (const line of io.lines()) session.line(line);
  } catch (e) {
    throw MitoriError.from(e);
  }
  await session.drain();
  return 0;
}
