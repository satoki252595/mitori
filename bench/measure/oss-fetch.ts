// Public OSS quality samples. No repository code, package scripts, hooks, or submodules are executed.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const cases = ["lnkiai/m3e-canvas", "browser-use/jev-ultrafast", "NandhaKishorM/laya"];
const directory = resolve("node_modules/.cache/mitori-oss-quality-20261005");
const evidence = resolve("docs/progress/oss-quality-2026-10-05");
mkdirSync(directory, { recursive: true });
mkdirSync(evidence, { recursive: true });
async function command(argv: string[]): Promise<string> {
  const result = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited]);
  if (code !== 0) throw new Error(`${argv[0]} failed: ${err.slice(-500)}`);
  return out.trim();
}
const samples = [];
for (const repo of cases) {
  const metadata = JSON.parse(await command(["gh", "api", `repos/${repo}`])) as {
    default_branch: string;
    stargazers_count: number;
    created_at: string;
    pushed_at: string;
    html_url: string;
    license: { spdx_id: string };
  };
  const commit = JSON.parse(await command(["gh", "api", `repos/${repo}/commits/${metadata.default_branch}`])) as { sha: string };
  const root = join(directory, repo.split("/")[1] as string);
  if (!existsSync(root))
    await command([
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "clone",
      "--depth=50",
      "--no-tags",
      "--no-recurse-submodules",
      `https://github.com/${repo}.git`,
      root,
    ]);
  const sha = await command(["git", "-C", root, "rev-parse", "HEAD"]);
  if (sha !== commit.sha) throw new Error(`${repo}: remote moved; record/select a fresh fixed commit before running`);
  samples.push({
    repo,
    sha,
    root,
    observedAt: new Date().toISOString(),
    stars: metadata.stargazers_count,
    createdAt: metadata.created_at,
    pushedAt: metadata.pushed_at,
    url: metadata.html_url,
    license: metadata.license.spdx_id,
  });
  console.log(`${repo}@${sha.slice(0, 12)} (${metadata.stargazers_count} stars)`);
}
writeFileSync(
  join(evidence, "selection.json"),
  `${JSON.stringify({ method: "GitHub API: created 2026-09-01..2026-10-05, >=200 stars, non-archived; choose two smaller TS/Python repositories plus a larger multilingual architecture", samples }, null, 2)}\n`,
);
