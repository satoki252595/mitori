/**
 * `mitori digest [--max-tokens 300]` (loop spec §10.7): one status line for a SessionStart hook (opt-in), e.g.
 * `mitori: doc r12 · open threads 3 · stale blocks 1 · run "mitori review" when asked`. Only for a workspace the
 * daemon already knows; with no daemon or no such workspace it prints nothing and exits 0 (a hook never starts a
 * daemon or opens a repository).
 */
import { intFlag, parse } from "./args.ts";
import type { Io } from "./io.ts";
import { connect } from "./session.ts";
import { real, workspaceContaining } from "./workspace.ts";

/** claude-v5 code chars/token: the line is ASCII. */
const CHARS_PER_TOKEN = 2.3;

/** The digest line of a workspace status. */
export function digestLine(st: { rev: number; counts: { openThreads: number; staleBlocks: number; runningJobs: number } }): string {
  const parts = [`doc r${st.rev}`, `open threads ${st.counts.openThreads}`, `stale blocks ${st.counts.staleBlocks}`];
  if (st.counts.runningJobs > 0) parts.push(`running jobs ${st.counts.runningJobs}`);
  return `mitori: ${parts.join(" · ")} · run "mitori review" when asked`;
}

export async function run(io: Io): Promise<number> {
  const { values } = parse(io.argv, { "max-tokens": { type: "string" } }, "digest");
  const max = intFlag(values["max-tokens"], "max-tokens", "digest", 10, 100_000) ?? 300;
  let s: Awaited<ReturnType<typeof connect>>;
  try {
    s = await connect(io, { start: false });
  } catch {
    return 0;
  }
  const w = workspaceContaining(await s.api.call("GET /workspaces", { params: {} }), real(io.cwd));
  if (!w) return 0;
  const line = digestLine(await s.api.call("GET /ws/:ws", { params: { ws: w.info.key } }));
  io.out(`${line.slice(0, Math.floor(max * CHARS_PER_TOKEN))}\n`);
  return 0;
}
