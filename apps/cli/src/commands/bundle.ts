/**
 * `mitori bundle <th> [--budget N] [--lines] [--mode pull|copy] [--target …]` (loop spec §10.2): the MBF/1 context of
 * one thread on stdout. `pull` (default) = `GET /threads/:th/bundle` (`--lines` → numbered code, CR m1-83); `copy` =
 * the Copy-as-prompt text of `POST /prompt` for another agent (`--target`).
 */
import { intFlag, oneOf, parse, threadArg } from "./args.ts";
import { type Io, usage } from "./io.ts";
import { agentLabelFromEnv } from "./loop-contract.ts";
import { connectWorkspace } from "./session.ts";
import { whenReady } from "./workspace.ts";

/** Bundle budget (tokens): default 4,000, max 12,000 (spec §10.2; the MCP schema's floor 500). */
export const BUNDLE_BUDGET = { def: 4000, min: 500, max: 12_000 } as const;

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    { budget: { type: "string" }, lines: { type: "boolean" }, mode: { type: "string" }, target: { type: "string" }, agent: { type: "string" } },
    "bundle",
  );
  const th = threadArg(positionals[0], "bundle");
  if (positionals.length > 1) throw usage(`unexpected argument ${positionals[1]}`, "mitori bundle --help");
  const budget = intFlag(values.budget, "budget", "bundle", BUNDLE_BUDGET.min, BUNDLE_BUDGET.max) ?? BUNDLE_BUDGET.def;
  const mode = oneOf(values.mode, ["pull", "copy"] as const, "mode", "bundle") ?? "pull";
  const target = oneOf(values.target, ["claude-code", "codex", "generic"] as const, "target", "bundle") ?? "claude-code";
  const s = await connectWorkspace(io, { agent: agentLabelFromEnv(values.agent, io.env) });
  const ws = s.ws.info.key;
  let text: string;
  if (mode === "pull") {
    text = await whenReady(io, () =>
      s.api.call("GET /ws/:ws/threads/:th/bundle", { params: { ws, th }, query: { budget, mode: "pull", ...(values.lines ? { lines: "1" } : {}) } }),
    );
  } else {
    const t = await whenReady(io, () => s.api.call("GET /ws/:ws/threads/:th", { params: { ws, th } }));
    const ask = t.messages.find((m) => m.by === "human")?.body ?? t.title;
    text = (await s.api.call("POST /ws/:ws/prompt", { params: { ws }, body: { anchor: t.anchor, ask, intent: t.intent, target } })).text;
  }
  io.out(text.endsWith("\n") ? text : `${text}\n`);
  return 0;
}
