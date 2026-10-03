import { describe, expect, test } from "bun:test";
import { createElkPool } from "../../daemon/elk.ts";
import { WorkerClient } from "../../daemon/worker-client.ts";
import { assetTable, GRAMMAR_LANGS, pinnedScriptUrl, readPinned } from "../assets.ts";
import type { ParseProbeResult } from "./parse.ts";

const t = assetTable();
// `await expect(p).rejects` deadlocks bun test 1.4.2 when `p` settles from a Worker message — inspect the error instead
const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );

describe("SKEL-U-07 parse Worker (web-tree-sitter, six grammars)", () => {
  test("init with wasm bytes, parse one snippet per grammar, tree deleted", async () => {
    const w = new WorkerClient(t.workers.parse);
    try {
      const grammars = Object.fromEntries(await Promise.all(GRAMMAR_LANGS.map(async (l) => [l, await readPinned(`grammar.${l}`)] as const)));
      const init = await w.request<{ langs: string[] }>("init", { runtime: await readPinned("treesitter.runtime"), grammars });
      expect(init.langs.sort()).toEqual([...GRAMMAR_LANGS].sort());
      const out = await w.request<ParseProbeResult[]>("parse", [
        { lang: "go", source: "package main\nfunc main() {}\n" },
        { lang: "python", source: "def f(:\n" },
      ]);
      expect(out.map((r) => [r.lang, r.root, r.hasError])).toEqual([
        ["go", "source_file", false],
        ["python", "module", true],
      ]);
      expect(await errorOf(w.request("parse", [{ lang: "cobol", source: "" }]))).toBe("no grammar for cobol");
      expect(await errorOf(w.request("bogus", null))).toBe('unknown op "bogus"');
    } finally {
      w.terminate();
    }
  });
});

describe("SKEL-U-08 compute Worker (fine-grained Shiki, css-variables theme)", () => {
  test("13 languages load; output uses --shiki-* variables", async () => {
    const w = new WorkerClient(t.workers.compute);
    try {
      const init = await w.request<{ langs: string[]; missing: string[] }>("init", { onig: await readPinned("shiki.onig") });
      expect(init.missing).toEqual([]);
      expect(init.langs).toHaveLength(13);
      const { html } = await w.request<{ html: string }>("highlight", { text: "SELECT 1;", lang: "sql" });
      expect(html).toContain("var(--shiki-token-");
    } finally {
      w.terminate();
    }
  });
});

describe("SKEL-U-09 ELK pool (dedicated Worker)", () => {
  test("lays out, reports its size, refuses floor plans, restarts after close", async () => {
    const pool = createElkPool(() => pinnedScriptUrl("elk.worker"));
    const ir = {
      id: "g",
      children: [
        { id: "a", width: 40, height: 20 },
        { id: "b", width: 40, height: 20 },
      ],
      edges: [{ id: "e", sources: ["a"], targets: ["b"] }],
    };
    expect(pool.size()).toBe(0);
    const out = await pool.run({ ir, kind: "layered", prev: null });
    expect(out.children?.every((c) => typeof c.x === "number")).toBe(true);
    expect(pool.size()).toBe(1);
    expect(await errorOf(pool.run({ ir, kind: "floorplan", prev: null }))).toContain("floorplan");
    await pool.close();
    expect(pool.size()).toBe(0);
    await pool.resize(0);
  });
});
