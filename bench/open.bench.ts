// Cold open of a repository through the real daemon: S0–S4 plus the static (0-token) doc — the time until the
// Reader can show the whole static design document (docs/design budgets: crit ≤ 1.0 s target, 2.0 s limit). Each
// run is a fresh process with an empty MITORI_HOME on a copy of the repo without `.mitori/` (a first open, no seeds).
// The sample is the child's own open time (POST /workspaces → static doc applied), not the process start-up.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineBench } from "./runner/define.ts";

const CHILD = join(import.meta.dir, "open-child.ts");

interface OpenState {
  copy: string;
}

async function openOnce(state: OpenState, home: string): Promise<number> {
  rmSync(join(state.copy, ".mitori"), { recursive: true, force: true });
  const proc = Bun.spawn([process.execPath, CHILD, state.copy, home], { stdout: "pipe", stderr: "pipe", env: { ...process.env, MITORI_HOME: home } });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const line = out.trim().split("\n").pop() ?? "";
  if (code !== 0 || !line.startsWith("{")) throw new Error(`open-child exited ${code}: ${err.slice(-400)}`);
  return (JSON.parse(line) as { open: number }).open;
}

const setup = (ctx: { repo: string | undefined }): OpenState => {
  if (!ctx.repo) throw new Error("open.bench needs a repo");
  const copy = mkdtempSync(join(tmpdir(), "mitori-open-"));
  cpSync(ctx.repo, copy, { recursive: true, filter: (p) => !/\/\.mitori(\/|$)/.test(p) });
  return { copy };
};

/** idx.s04.cold.100kloc: crit (≈ 65k LOC, 1,200 files), S0–S4 + static doc. */
export const coldOpenCrit = defineBench<OpenState>({
  id: "idx.s04.cold.100kloc",
  suite: "idx",
  mode: "process",
  repo: "crit",
  runs: 5,
  warmup: 1,
  setup,
  run: (state, ctx) => openOnce(state, ctx.home),
  teardown: (state) => rmSync(state.copy, { recursive: true, force: true }),
});
