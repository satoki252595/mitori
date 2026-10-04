// EX-01 (expert audit, critical) end to end on the real daemon: a workspace whose module pages carry authored text is
// copied to a NEW path and opened with a FRESH home (moved repo, teammate's clone with docCommitted, reinstall). The
// index is rebuilt from scratch and seeded from `.mitori/doc.index.json`; the module pages must come back with their
// ids and bytes — before, re-partitioning replaced 14 of 16 generated pages with 「未生成」 stubs. Zero tokens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleId, SectionId, WorkspaceKey } from "@mitori/core";
import { type Int, startInt } from "./harness.ts";

let repo: { root: string; dispose(): Promise<void> };
let copy: string;

/**
 * A repo big enough for several modules (leaves are ≈ 2–6k LOC by default): four packages of five 520-line TS files
 * that import each other inside the package and a little across packages.
 */
function synthRepo(): { root: string; dispose(): Promise<void> } {
  const root = mkdtempSync(join(tmpdir(), "mitori-repart-"));
  const pkgs = ["billing", "catalog", "search", "users"];
  for (const [pi, pkg] of pkgs.entries()) {
    mkdirSync(join(root, "src", pkg), { recursive: true });
    for (let f = 0; f < 5; f++) {
      const lines = [`// ${pkg} part ${f}`];
      if (f > 0) lines.push(`import { ${pkg}${f - 1}_0 } from "./part${f - 1}.ts";`);
      if (f === 0 && pi > 0) lines.push(`import { ${pkgs[pi - 1]}0_0 } from "../${pkgs[pi - 1]}/part0.ts";`);
      for (let k = 0; k < 64; k++) {
        lines.push(`export function ${pkg}${f}_${k}(x: number): number {`);
        for (let j = 0; j < 6; j++) lines.push(`  x = x * ${j + 2} + ${k}; // step ${j}`);
        lines.push(`  return x;`, `}`);
      }
      writeFileSync(join(root, "src", pkg, `part${f}.ts`), `${lines.join("\n")}\n`);
    }
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "repart", version: "1.0.0", type: "module" }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "-A"],
    ["commit", "-qm", "init"],
  ]) {
    const r = Bun.spawnSync(["git", ...args], { cwd: root, env });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  }
  return { root, dispose: async () => rmSync(root, { recursive: true, force: true }) };
}
const homes: Int[] = [];

beforeAll(async () => {
  repo = synthRepo();
  copy = mkdtempSync(join(tmpdir(), "mitori-moved-"));
}, 60_000);
afterAll(async () => {
  for (const i of homes) await i.close();
  await repo?.dispose();
  rmSync(copy, { recursive: true, force: true });
});

const modulePages = (root: string) => {
  const dir = join(root, ".mitori", "doc", "modules");
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
  );
};

describe("EX-01 moved / cloned / fresh-home open keeps authored module pages", () => {
  let before: Record<string, string>;
  let ids: ModuleId[];

  test("write a human sentence into every module page, flush", async () => {
    const int = await startInt();
    homes.push(int);
    const { ws } = await int.open(repo.root);
    const web = await int.browser();
    const doc = int.domain(ws).doc;
    const mods = doc.index().modules;
    expect(mods.length).toBeGreaterThanOrEqual(3);
    for (const m of mods) {
      const ph = doc.section(m.section as SectionId)?.blocks.find((b) => b.kind === "placeholder");
      if (!ph) continue;
      const res = await web.req("POST", `/ws/${ws as WorkspaceKey}/doc/blocks/${ph.id}/edit`, {
        baseHash: ph.hash,
        md: `${m.name} は人が説明を書いた部屋である。`,
        mdForm: "file",
        apply: "doc",
      });
      expect(res.status).toBe(200);
    }
    await doc.flush({ force: true });
    before = modulePages(repo.root);
    ids = doc
      .index()
      .modules.map((m) => m.id)
      .sort();
    expect(Object.values(before).filter((t) => t.includes("は人が説明を書いた部屋である")).length).toBeGreaterThanOrEqual(3);
    // the sidecar records the exact partition
    expect(doc.index().modules.every((m) => (m.members?.length ?? 0) > 0)).toBe(true);
    await int.close();
    homes.pop();
  }, 60_000);

  test("copy to a new path, open with a fresh home: same module ids, every page byte-identical, no orphans", async () => {
    cpSync(repo.root, copy, { recursive: true });
    const int = await startInt(); // a new MITORI_HOME: no state DB, the partition comes from doc.index.json alone
    homes.push(int);
    const { ws } = await int.open(copy);
    const doc = int.domain(ws).doc;
    await doc.flush({ force: true });
    expect(
      doc
        .index()
        .modules.map((m) => m.id)
        .sort(),
    ).toEqual(ids);
    expect(modulePages(copy)).toEqual(before);
    expect(() => readdirSync(join(copy, ".mitori", "orphaned"))).toThrow();
  }, 60_000);
});
