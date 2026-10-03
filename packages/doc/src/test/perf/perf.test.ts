// WP-04 performance acceptance (bench/budgets/doc.json): render 2,000 blocks cached ≤ 100 ms / cold ≤ 1 s,
// ELK layered 300 nodes ≤ 100 ms / 1,000 ≤ 400 ms (real ELK Worker), 1-block flush on a 10k-block doc ≤ 5 ms CPU
// (DOC-B-001). Timing assertions are machine-dependent, so the file runs only with MITORI_PERF=1:
//   MITORI_PERF=1 scripts/nd bun test packages/doc/src/test/perf
import { afterAll, describe, expect, test } from "bun:test";
import { type Block, type BlockId, type Claim, type ClaimId, createSecretScanner, type DiagramIR, type DiagramLayout, type WorkspaceKey } from "@mitori/core";
import ELK from "elkjs/lib/elk-api.js";
import type { GeneratedBlock, HighlightReq } from "../../contract.ts";
import { type ElkGraphNode, elkLayout } from "../../layout/elk.ts";
import { createDiagramLayouter } from "../../layout/index.ts";
import { createBlockRenderer } from "../../render/index.ts";
import { createHighlight } from "../../render/shiki.ts";
import { DOC_MIGRATIONS } from "../../store/index.ts";
import { syntheticGraph } from "../graphs.ts";
import { harness, staticInputFromTruth } from "../harness.ts";
import { hasher, inlinePool, memDb, silentLog } from "../helpers.ts";

const RUN = process.env.MITORI_PERF === "1";
const results: Record<string, number> = {};
afterAll(() => {
  if (RUN) console.log(`perf results (ms): ${JSON.stringify(results)}`);
});

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

function corpus(n: number): { block: Block; claims: Claim[] }[] {
  const out: { block: Block; claims: Claim[] }[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 20 === 0 ? "code" : i % 10 === 1 ? "list" : i % 25 === 2 ? "table" : i % 33 === 3 ? "learn" : "prose";
    const md =
      kind === "code"
        ? `\`\`\`ts\nexport function f${i}(a: number, b: string): string {\n  // comment ${i}\n  return \`\${a}-\${b}\`;\n}\n\`\`\``
        : kind === "list"
          ? `- \`Store.Get${i}\` は ID から取り出す（[store.go:${i}-${i + 9}](../../src/store.go#L${i}-L${i + 9})）。\n- 期限切れなら \`ErrExpired\` を返す（推測）。\n- 並行アクセスは mutex で守る。`
          : kind === "table"
            ? `| 名前 | 説明 |\n|---|---|\n| \`a${i}\` | 一つ目 |\n| \`b${i}\` | 二つ目 |`
            : kind === "learn"
              ? "- セッションの保存と取り出し\n- 期限切れの扱い"
              : `ブロック ${i} の本文。セッションを発行・検証・失効させる（[login.go:${i + 1}-${i + 40}](../../internal/auth/login.go#L${i + 1}-L${i + 40})）。認可の判定は行わない（推測）。**太字**と \`code\` を含む English text as well.`;
    const id = `b_${String(i).padStart(8, "0")}` as BlockId;
    const block = {
      id,
      section: "s1",
      file: "doc/01-what-why.md",
      ord: i,
      kind,
      depth: "L1",
      audience: [],
      lang: "ja",
      origin: "ai",
      status: "ready",
      freshness: "fresh",
      hash: hasher.xxh3(md),
      claims: [],
      readingSec: 1,
      md,
    } as Block;
    const claims: Claim[] =
      kind === "prose" || kind === "list"
        ? [0, 1].map((k) => ({
            id: `cl_${String(i * 2 + k).padStart(8, "0")}` as ClaimId,
            block: id,
            kind: "behavior",
            quote: "",
            cites:
              k === 0 ? [{ path: "internal/auth/login.go", start: i + 1, end: i + 40, blob: "a".repeat(40), snippet: "0".repeat(16), precision: "exact" }] : [],
            verdict: k === 0 ? "verified" : "inferred",
            checks: { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00Z" },
          }))
        : [];
    out.push({ block, claims });
  }
  return out;
}

describe.skipIf(!RUN)("WP-04 perf budgets", () => {
  test("doc.render.2000 cold ≤ 1 s, cached ≤ 100 ms (Shiki in-thread, real grammars)", async () => {
    const hl = await createHighlight(import("shiki/wasm"));
    const renderer = createBlockRenderer({
      highlighter: inlinePool((r: HighlightReq) => hl(r)),
      secrets: createSecretScanner(),
      hasher,
      db: memDb(DOC_MIGRATIONS),
      log: silentLog,
    });
    const blocks = corpus(2000);
    const ws = "ws_000000000000" as WorkspaceKey;
    const opts = {
      lang: "ja" as const,
      glossaryTerms: new Map([
        ["セッション", "gl_00000001"],
        ["mutex", "gl_00000002"],
      ]),
    };
    // warm the JIT on a different corpus
    for (const { block, claims } of corpus(50))
      renderer.splice(await renderer.render({ ...block, hash: `w${block.hash}` }, claims, opts), claims, { ws, level: "standard" });
    let t = performance.now();
    for (const { block, claims } of blocks) renderer.splice(await renderer.render(block, claims, opts), claims, { ws, level: "standard" });
    results["doc.render.2000.cold"] = performance.now() - t;
    const cached: number[] = [];
    for (let r = 0; r < 5; r++) {
      t = performance.now();
      for (const { block, claims } of blocks) renderer.splice(await renderer.render(block, claims, opts), claims, { ws, level: "standard" });
      cached.push(performance.now() - t);
    }
    results["doc.render.2000.cached"] = median(cached);
    expect(results["doc.render.2000.cold"]).toBeLessThanOrEqual(1000);
    expect(results["doc.render.2000.cached"]).toBeLessThanOrEqual(100);
  });

  test("doc.elk.300 ≤ 100 ms, doc.elk.1000 ≤ 400 ms (dedicated ELK Worker)", async () => {
    const elk = new ELK({ workerUrl: require.resolve("elkjs/lib/elk-worker.min.js"), workerFactory: (u) => new Worker(u as string) as never });
    const api = elk as unknown as { layout(g: ElkGraphNode): Promise<ElkGraphNode> };
    const pool = inlinePool((req: { ir: DiagramIR }) => elkLayout(api, req));
    try {
      for (const n of [300, 1000]) {
        const times: number[] = [];
        for (let seed = 1; seed <= 7; seed++) {
          const layouter = createDiagramLayouter({ elk: pool as never, db: memDb(DOC_MIGRATIONS), hasher, log: silentLog });
          const ir = syntheticGraph(n, { seed });
          const t = performance.now();
          const l: DiagramLayout = await layouter.layout(ir);
          if (seed > 2) times.push(performance.now() - t);
          expect(l.nodes.length).toBe(n);
        }
        results[`doc.elk.${n}`] = median(times);
      }
    } finally {
      elk.terminateWorker();
    }
    expect(results["doc.elk.300"]).toBeLessThanOrEqual(100);
    expect(results["doc.elk.1000"]).toBeLessThanOrEqual(400);
  }, 60_000);

  test("doc.flush.10k: one block update on a 10k-block doc ≤ 5 ms CPU (DOC-B-001)", async () => {
    const h = harness();
    const input = staticInputFromTruth("ts-small");
    const base = input.modules[0] as (typeof input.modules)[number];
    input.modules = Array.from({ length: 100 }, (_, i) => ({
      ...base,
      id: `md_${String(i).padStart(8, "0")}` as never,
      slug: `module-${i}`,
      name: `モジュール ${i}`,
      paths: [`src/m${i}/a.ts`, `src/m${i}/b.ts`],
    }));
    h.store.applyStatic(input);
    const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.module@1", indexDigest: "0".repeat(16) } as const;
    const checks = { l0: true, l1: "pass" as const, l2: true, checkedAt: "2026-01-01T00:00:00.000Z" };
    const aspects = ["responsibility", "interface", "dependencies", "data", "flow", "config", "tests", "invariants", "errors", "performance"] as const;
    let first: BlockId | null = null;
    for (const m of h.store.index().modules) {
      const blocks: GeneratedBlock[] = Array.from({ length: 98 }, (_, k) => ({
        id: null,
        section: m.section,
        aspect: aspects[k % aspects.length] as (typeof aspects)[number],
        kind: "prose",
        depth: "L2",
        audience: ["dev"],
        lang: "ja",
        md: `\`f${k}\` は入力を検証する[[1]]。失敗時は \`ErrInvalid\` を返す[[2]]。`,
        claims: [1, 2].map((n) => ({
          n,
          kind: "behavior" as const,
          quote: "",
          cites: [{ path: `src/${m.slug}/a.ts`, start: k + n, end: k + n + 5, blob: "a".repeat(40), snippet: "0".repeat(16), precision: "exact" as const }],
          checks,
          verdict: "verified" as const,
        })),
        gen,
      }));
      const res = h.store.applyGenerated(blocks, { mode: "write", deletes: [], source: { kind: "regen", id: "gr_00000001" }, reason: "bench", listed: 0 });
      first ??= res.written[0] as BlockId;
    }
    const total = h.store.sections().reduce((a, s) => a + s.blocks.length, 0);
    expect(total).toBeGreaterThanOrEqual(10_000);
    await h.store.flush({ force: true });
    const cpu: number[] = [];
    const wall: number[] = [];
    for (let r = 0; r < 9; r++) {
      h.store.applyGenerated(
        [
          {
            id: first as BlockId,
            section: h.store.block(first as BlockId)?.section as never,
            aspect: "responsibility",
            kind: "prose",
            depth: "L2",
            audience: ["dev"],
            lang: "ja",
            md: `更新 ${r} 回目の本文[[1]]。`,
            claims: [
              {
                n: 1,
                kind: "behavior",
                quote: "",
                cites: [{ path: "src/a.ts", start: 1, end: 3, blob: "a".repeat(40), snippet: "0".repeat(16), precision: "exact" }],
                checks,
                verdict: "verified",
              },
            ],
            gen,
          },
        ],
        { mode: "write", deletes: [], source: { kind: "regen", id: "gr_00000001" }, reason: "bench", listed: 0 },
      );
      const c0 = process.cpuUsage();
      const t0 = performance.now();
      const files = await h.store.flush();
      wall.push(performance.now() - t0);
      const c = process.cpuUsage(c0);
      cpu.push((c.user + c.system) / 1000);
      expect(files.length).toBeGreaterThanOrEqual(2);
    }
    results["doc.flush.10k.cpu"] = median(cpu.slice(2));
    results["doc.flush.10k.wall"] = median(wall.slice(2));
    results["doc.flush.10k.indexBytes"] = h.mem?.files.get("doc.index.json")?.length ?? 0;
    expect(results["doc.flush.10k.cpu"]).toBeLessThanOrEqual(5);
    expect(results["doc.flush.10k.wall"]).toBeLessThanOrEqual(20);
  }, 120_000);
});
