// Per-repository structure numbers behind idx.pack.tokens / idx.module.sig.tokens / idx.leaf.loc (the bench cases report
// the corpus maximum): `bun bench/runners/idx-structure.ts [repo,…]` prints one Markdown row per fetched corpus repo.
import { join } from "node:path";
import { REPO_ROOT, runJson, scratch } from "../lib/child.ts";
import { resolveRepo } from "../runner/repos.ts";
import type { ColdResult } from "./idx-cold.ts";

const names = (process.argv[2] ?? "crit,m3e-canvas,flask,ripgrep,hono,excalidraw,fastapi,react").split(",");
console.log("| repo | leaves | repo pack (tokens) | largest leaf sig skeleton (tokens) | that leaf (LOC) | leaf LOC p10 / median / p90 |");
console.log("|---|---:|---:|---:|---|---|");
for (const name of names) {
  let repo: Awaited<ReturnType<typeof resolveRepo>>;
  try {
    repo = await resolveRepo(name, REPO_ROOT);
  } catch (err) {
    console.log(`| ${name} | — | — | — | not fetched: ${err instanceof Error ? err.message : String(err)} | — |`);
    continue;
  }
  const home = scratch("structure");
  try {
    const r = await runJson<ColdResult>(join(import.meta.dir, "idx-cold.ts"), ["--repo", repo.path, "--home", home.dir, "--structure"]);
    const s = r.structure;
    if (!s) continue;
    console.log(
      `| ${name} | ${s.leaves} | ${s.packTokens} | ${s.sigTokensMax} | \`${s.sigTokensMaxLeaf}\` (${s.sigTokensMaxLoc}) | ${s.leafLoc.p10} / ${s.leafLoc.median} / ${s.leafLoc.p90} |`,
    );
  } finally {
    home.dispose();
    await repo.dispose();
  }
}
