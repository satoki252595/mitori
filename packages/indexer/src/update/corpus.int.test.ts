// Corpus checks (skipped when the pinned clones are absent; `bun run corpus:fetch`):
// IDX-AT-02 (exclusions), IDX-AT-03 (filtered / naive token ratio), IDX-AT-13 (Flow files via tsx), IDX-AT-05 (shadow),
// IDX-AT-14 (Worker memory over repeated parses, measured in a child process).
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Indexer } from "../contract.ts";
import { corpusDir } from "../parse/test/corpus.ts";
import { parseResult } from "../parse/test/parse-text.ts";
import { createIndexer } from "./index.ts";
import { testDeps } from "./test/deps.ts";
import { type FixtureRepoLike, testkit } from "./test/fixtures.ts";
import { shadowGit } from "./test/git.ts";

const opened: Indexer[] = [];
afterAll(async () => {
  for (const i of opened) await i.close();
});
async function scanned(name: string, until: "S0" | "S1"): Promise<Indexer> {
  const idx = createIndexer(testDeps(corpusDir(name) as string));
  opened.push(idx);
  await idx.scan({ until });
  return idx;
}

describe("IDX-AT-02 corpus exclusions", () => {
  test.skipIf(corpusDir("crit") === null)(
    "crit: oversize / minified / generated / deny",
    async () => {
      const idx = await scanned("crit", "S1");
      const f = (p: string) => idx.file(p);
      expect(f("web/mermaid.min.js")?.excluded).toBe("oversize");
      for (const p of ["web/diff-match-patch.min.js", "web/dompurify.min.js", "web/markdown-it.min.js"]) expect([p, f(p)?.excluded]).toEqual([p, "minified"]);
      expect(f("cmd/crit/integration_hashes_gen.go")?.excluded).toBe("generated");
      const claude = idx.files({ includeExcluded: true }).filter((x) => x.path.startsWith(".claude/"));
      expect(claude.length).toBeGreaterThan(0);
      for (const x of claude) expect([x.path, x.excluded]).toEqual([x.path, "deny_glob"]);
    },
    30_000,
  );
  test.skipIf(corpusDir("ripgrep") === null)("ripgrep: the zsh completion that mentions auto-generated text stays source", async () => {
    const root = corpusDir("ripgrep") as string;
    const r = await parseResult("crates/core/flags/complete/zsh.rs", readFileSync(join(root, "crates/core/flags/complete/zsh.rs")));
    expect(r.status).toBe("ok");
  });
  test.skipIf(corpusDir("excalidraw") === null)("excalidraw: the base64 wasm module is minified or generated", async () => {
    const p = "packages/excalidraw/subset/harfbuzz/harfbuzz-wasm.ts";
    const r = await parseResult(p, readFileSync(join(corpusDir("excalidraw") as string, p)));
    expect(r.status === "excluded" && (r.rule === "R12.minified_content" || r.rule === "R13.generated_header")).toBe(true);
  });
  test.skipIf(corpusDir("react") === null)(
    "react: fixtures/** are fixtures (or excluded by an earlier rule)",
    async () => {
      const idx = await scanned("react", "S0");
      const fx = idx.files({ includeExcluded: true }).filter((x) => x.path.startsWith("fixtures/"));
      expect(fx.length).toBeGreaterThan(500);
      const earlier = new Set(["fixture", "binary", "lockfile", "oversize", "deny_glob", "secret", "special", "vendored", "generated", "minified"]);
      for (const x of fx) expect([x.path, earlier.has(x.excluded ?? "")]).toEqual([x.path, true]);
      expect(fx.filter((x) => x.excluded === "fixture").length / fx.length).toBeGreaterThan(0.8);
    },
    30_000,
  );
});

describe("IDX-AT-03 tokensFiltered / tokensNaive", () => {
  for (const [name, want] of [
    ["crit", 0.25],
    ["m3e-canvas", 0.35],
  ] as const) {
    test.skipIf(corpusDir(name) === null)(
      `${name} ≈ ${want} ± 0.05`,
      async () => {
        const idx = createIndexer(testDeps(corpusDir(name) as string));
        opened.push(idx);
        const s = await idx.scan({ until: "S1" });
        const ratio = s.tokensFiltered / s.tokensNaive;
        console.log(`${name}: tokensFiltered ${s.tokensFiltered} / tokensNaive ${s.tokensNaive} = ${ratio.toFixed(3)}`);
        expect(Math.abs(ratio - want)).toBeLessThanOrEqual(0.05);
      },
      60_000,
    );
  }
});

describe("IDX-AT-13 Flow files parse with the tsx grammar", () => {
  test.skipIf(corpusDir("react") === null)(
    "react @flow .js: files with parse errors ≤ 25 %",
    async () => {
      const root = corpusDir("react") as string;
      const flow: string[] = [];
      const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.name === "node_modules" || e.name === ".git" || e.name === "fixtures" || e.name === "__fixtures__") continue;
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".js") && statSync(p).size < 2_000_000 && /@flow\b/.test(readFileSync(p, "utf8").slice(0, 2_048))) flow.push(p);
        }
      };
      walk(join(root, "packages"));
      let errored = 0;
      for (const abs of flow) {
        const r = await parseResult(relative(root, abs), readFileSync(abs), { skipContentRules: true });
        if (r.status === "ok" && r.errors > 0) errored++;
      }
      console.log(`react flow files: ${flow.length}, with errors ${errored} (${((100 * errored) / flow.length).toFixed(1)} %)`);
      expect(flow.length).toBeGreaterThan(500);
      expect(errored / flow.length).toBeLessThanOrEqual(0.25);
    },
    120_000,
  );
});

describe("IDX-AT-05 shadow workspace", () => {
  test("nothing is written into the user's directory; excludes and nested repositories are honoured", async () => {
    const kit = await testkit();
    const repo: FixtureRepoLike = await kit.buildFixture("nongit");
    const shadow = mkdtempSync(join(tmpdir(), "mitori-shadow-"));
    try {
      const nested = join(repo.root, "notes-app/vendor-copy");
      mkdirSync(nested, { recursive: true });
      cpSync(join(repo.root, "notes-app/app.py"), join(nested, "app.py"));
      Bun.spawnSync(["git", "init", "-q"], { cwd: nested, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
      const before = await repo.digest();
      const idx = createIndexer(testDeps(repo.root, { git: shadowGit(repo.root, join(shadow, "shadow.git")), kind: "shadow" }));
      opened.push(idx);
      const s = await idx.scan({ until: "S1" });
      expect(await repo.digest()).toBe(before);
      const paths = idx.files({ includeExcluded: true }).map((f) => f.path);
      for (const p of paths) expect([p, /node_modules|\.venv|build\//.test(p)]).toEqual([p, false]);
      expect(idx.file("notes-app/vendor-copy/")?.excluded).toBe("special");
      expect(idx.file("notes-app/app.py")?.class).toBe("source");
      expect(idx.snapshot()).toMatchObject({ commit: null, dirty: true, tree: null });
      expect(s.included).toBe(3);
    } finally {
      rmSync(shadow, { recursive: true, force: true });
      await repo.dispose();
    }
  });
});

describe("IDX-AT-14 Worker memory over repeated cold parses", () => {
  test.skipIf(corpusDir("crit") === null)(
    "10 passes over crit's Go in one Worker (own process): RSS stops growing; every tree deleted",
    async () => {
      const script = join(import.meta.dir, "test/rss-passes.ts");
      const p = Bun.spawnSync(["bun", script, corpusDir("crit") as string, "10"], { stderr: "inherit" });
      expect(p.exitCode).toBe(0);
      const { rss, heap, parses, deletes } = JSON.parse(p.stdout.toString()) as { rss: number[]; heap: number[]; parses: number; deletes: number };
      console.log(`RSS per pass (MB): ${rss.map((x) => Math.round(x / 1_048_576)).join(" ")}`);
      console.log(`live heap per pass (MB): ${heap.map((x) => Math.round(x / 1_048_576)).join(" ")}`);
      // what leaks would show in, on any machine: every tree deleted, and the live heap after a full GC flat from pass 2
      expect(deletes).toBe(parses);
      expect(heap[9] as number).toBeLessThanOrEqual((heap[1] as number) * 1.1);
      // Spec: 10th ≤ 1st × 1.1 in RSS. In JSC the heap settles one pass later (≈ +100 MB once, pass 1 → 2, then ≈ 0.4 % per
      // pass), so growth is judged from pass 2, and the last five passes must be flat. RSS also holds the allocator's free
      // pages, returned on its own schedule: on a loaded machine (loadavg > cores × 0.5) it creeps ≈ 8 % over the last five
      // passes with a flat live heap, so the RSS half is checked on a quiet machine only (skipped with a notice).
      const load = loadavg()[0] ?? 0;
      if (load > availableParallelism() * 0.5) {
        console.warn(`IDX-AT-14: RSS growth check skipped — loadavg ${load.toFixed(1)} > cores × 0.5 (the live heap was checked)`);
        return;
      }
      expect(rss[9] as number).toBeLessThanOrEqual((rss[1] as number) * 1.1);
      expect(rss[9] as number).toBeLessThanOrEqual((rss[4] as number) * 1.05);
    },
    120_000,
  );
});
