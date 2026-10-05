// CR gen #8 end to end on the real daemon: the same commit, opened as a fresh copy with a fresh home, again and
// again (moved repo, teammate's clone of a committed doc, reinstall). Every open after the first is seeded from the
// `.mitori/doc.index.json` the previous one wrote. The module partition (ids, slugs, tree, members) and therefore
// the generation plan (task counts per stage, input tokens) must not change: before, the parent modules were re-born
// on every seeded open (`internal` ⇄ `internal-2`), and the complete estimate counted 42 or 43 file-note tasks for
// one commit. Zero tokens (estimates only). Skips when the corpus clone is absent (`bun run corpus:fetch`).
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceKey } from "@mitori/core";
import { startInt } from "./harness.ts";

const CORPUS = process.env.MITORI_CORPUS_DIR ?? join(homedir(), ".cache", "mitori-corpus");
const corpus = (name: string): string | null => {
  if (!existsSync(CORPUS)) return null;
  const hit = readdirSync(CORPUS).find((d) => d === name || d.startsWith(`${name}@`));
  return hit ? join(CORPUS, hit) : null;
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A copy of `src` without its `.mitori/` (the corpus clone may carry one from earlier opens). */
function freshCopy(src: string, from?: string): string {
  const d = mkdtempSync(join(tmpdir(), "mitori-reopen-"));
  dirs.push(d);
  cpSync(from ?? src, d, { recursive: true, filter: (p) => from !== undefined || !/\/\.mitori(\/|$)/.test(p) });
  return d;
}

interface Snapshot {
  partition: string[];
  plan: string[];
}

async function openOnce(root: string): Promise<Snapshot> {
  const int = await startInt(); // fresh home: no state DB, the partition comes from the checkout (and its .mitori/)
  try {
    const { ws } = await int.open(root);
    const d = int.domain(ws as WorkspaceKey);
    await d.doc.flush({ force: true });
    const partition = d.indexer
      .modules()
      .map((m) => `${m.id} ${m.slug} ${m.parent ?? "-"} ${[...m.paths].sort().join(",")}`)
      .sort();
    const est = await d.gen.estimate({ effort: "complete" });
    const plan = est.stages.map((s) => `${s.stage} tasks=${s.tasks} in=${s.inTokens}`);
    return { partition, plan };
  } finally {
    await int.close();
  }
}

for (const name of ["crit", "excalidraw"]) {
  const src = corpus(name);
  describe.skipIf(src === null)(`CR gen #8 ${name}: reopening the same commit in a fresh copy and home`, () => {
    test("keeps the module partition and the generation plan, open after open", async () => {
      let root = freshCopy(src as string);
      const first = await openOnce(root);
      expect(first.partition.length).toBeGreaterThan(5);
      for (let open = 1; open <= 2; open++) {
        root = freshCopy(src as string, root); // the previous copy with the .mitori/ it wrote
        const again = await openOnce(root);
        expect(again.partition).toEqual(first.partition);
        expect(again.plan).toEqual(first.plan);
      }
    }, 240_000);
  });
}

const react = corpus("react");
test.skipIf(react === null)(
  "F16 React: independent clean cold opens and seeded reopens keep the partition and plan",
  async () => {
    const child = join(import.meta.dir, "../../bench/open-child.ts");
    // Run the existing process-mode helper at runtime; bench references test, so a static project reference would cycle.
    const { runJson } = await import(join(import.meta.dir, "../../bench/lib/child.ts"));
    const open = async (root: string) => {
      const home = mkdtempSync(join(tmpdir(), "mitori-react-home-"));
      dirs.push(home);
      return (await runJson(child, [root, home, "--partition"])).partition as { source: { commit: string }; modules: string[]; plan: string[] };
    };
    const firstRoot = freshCopy(react as string);
    const first = await open(firstRoot);
    expect(first.modules.length).toBeGreaterThan(5);
    const clean = await open(freshCopy(react as string));
    expect(clean.source.commit).toBe(first.source.commit);
    expect(clean.modules).toEqual(first.modules);
    expect(clean.plan).toEqual(first.plan);
    let seededRoot = firstRoot;
    for (let n = 0; n < 2; n++) {
      seededRoot = freshCopy(react as string, seededRoot);
      const seeded = await open(seededRoot);
      expect(seeded.source.commit).toBe(first.source.commit);
      expect(seeded.modules).toEqual(first.modules);
      expect(seeded.plan).toEqual(first.plan);
    }
  },
  240_000,
);
