// `bun fixtures/build.ts [--only <name>] [--update | --verify]` (testing spec §1.3 `fixtures:build`, §2.2).
// Builds every fixture repo into a temp dir (deterministic commits) and compares the commit ids with
// fixtures/golden/<name>/commits.json: --verify fails on a difference, --update rewrites the files. Plain run = smoke build.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "@mitori/core";
import { buildFixture, type FixtureName } from "@mitori/testkit";

const root = import.meta.dir;
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : undefined;
const mode = argv.includes("--update") ? "update" : argv.includes("--verify") ? "verify" : "build";

const names = readdirSync(join(root, "repos"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, "repos", d.name, "fixture.json")))
  .map((d) => d.name as FixtureName)
  .filter((n) => !only || n === only)
  .sort();
if (names.length === 0) {
  console.error(`fixtures:build: no fixture${only ? ` named ${only}` : ""}`);
  process.exit(1);
}

let failed = 0;
for (const name of names) {
  const t0 = performance.now();
  const repo = await buildFixture(name);
  try {
    const file = join(root, "golden", name, "commits.json");
    const text = canonicalJson({ v: "mitori.fixture-commits/1", fixture: name, commits: repo.commits });
    let note = `${repo.commits.length} commit(s)`;
    if (repo.git && mode === "update") {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      note += ", commits.json updated";
    } else if (repo.git && mode === "verify") {
      const same = existsSync(file) && readFileSync(file, "utf8") === text;
      if (!same) failed++;
      note += same ? ", commits.json ok" : ", commits.json DIFFERS (run: bun fixtures/build.ts --update)";
    }
    console.log(`${name.padEnd(16)} ${note} (${Math.round(performance.now() - t0)} ms)`);
  } finally {
    await repo.dispose();
  }
}
process.exit(failed > 0 ? 1 : 0);
