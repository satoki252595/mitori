// Run the three fixed public samples serially. Each engine lane has at most 2 lean Muse processes.
// Total API-equivalent cap is $0.90; reserve $0.10 for a scoped quality repair.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.env.MITORI_LIVE !== "1") throw new Error("set MITORI_LIVE=1 for the explicitly requested real OSS experiment");
const config = process.argv[2];
if (!config) throw new Error("pass the private Muse config path");
const evidence = resolve("docs/progress/oss-quality-2026-10-05");
const { samples } = JSON.parse(readFileSync(join(evidence, "selection.json"), "utf8")) as { samples: { repo: string; root: string; sha: string }[] };
for (const sample of samples) {
  const name = sample.repo.split("/")[1] as string;
  const head = Bun.spawnSync(["git", "-C", sample.root, "rev-parse", "HEAD"]).stdout.toString().trim();
  if (head !== sample.sha) throw new Error(`${name}: selected source commit changed`);
  console.error(`OSS experiment ${name}@${head}`);
  const run = Bun.spawn(
    [
      "bun",
      "bench/measure/gen-real.ts",
      "--repo",
      sample.root,
      "--engine",
      "generic",
      "--config",
      resolve(config),
      "--effort",
      "standard",
      "--home",
      resolve("node_modules/.cache/mitori-oss-quality-20261005", `${name}-live-home`),
      "--out",
      join(evidence, name),
      "--concurrency",
      "2",
      "--run",
      "--max-usd",
      "0.30",
      "--timeout-min",
      "45",
      "--record",
      resolve("node_modules/.cache/mitori-oss-quality-20261005", `${name}-raw`),
    ],
    { env: process.env, stdout: "inherit", stderr: "inherit" },
  );
  const exit = await run.exited;
  console.error(`OSS ${name} exit=${exit}`);
  if (exit !== 0) throw new Error(`${name}: generation incomplete; inspect its report before spending on another run`);
}
