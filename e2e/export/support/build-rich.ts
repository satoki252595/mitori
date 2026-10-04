// `bun e2e/export/support/build-rich.ts <outDir>` — an export of a doc that has everything the dogfood docs (imported
// without their sidecar: every block L1, no glossary, no IR) cannot show: all four depths with deep dives / why / pitfall
// callouts, a glossary with terms used in the prose, verified / cited / inferred / unsupported / stale claims, a flow
// diagram from an IR with groups, a sequence diagram, a table and long code cites. The doc is written through the REAL doc
// store of an in-process daemon (test/int/harness), the HTML comes out of the REAL `POST /export` route.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DOC_TEMPLATE, type ExportReq, type ExportRes } from "@mitori/core";
import type { GeneratedBlock } from "@mitori/doc";
import { buildFixture } from "@mitori/testkit";
import { startInt } from "../../../test/int/harness.ts";

const out = resolve(process.argv[2] ?? "test-results/export-e2e");
mkdirSync(out, { recursive: true });
void DOC_TEMPLATE;

const repo = await buildFixture("ts-small");
const int = await startInt();
try {
  const { ws } = await int.open(repo.root);
  const d = int.domain(ws);
  const blob = (path: string) => d.indexer.currentBlob(path) ?? "0".repeat(40);
  const checks = (over: Partial<{ l0: boolean; l1: "pass" | "fail" | "vacuous"; l2: boolean }> = {}) => ({
    l0: true,
    l1: "pass" as const,
    l2: true,
    checkedAt: "2026-10-04T00:00:00.000Z",
    ...over,
  });
  const cite = (path: string, start: number, end: number) => ({ path, start, end, blob: blob(path), snippet: "0123456789abcdef", precision: "exact" as const });
  const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.overview@1", indexDigest: "0".repeat(16) } as const;
  const b = (over: Partial<GeneratedBlock>): GeneratedBlock => ({
    id: null,
    section: "s1",
    aspect: "problem",
    kind: "prose",
    depth: "L0",
    audience: ["newcomer", "dev"],
    lang: "ja",
    md: "",
    claims: [],
    gen,
    ...over,
  });
  const IMPORTER = "src/services/importer.ts";
  d.doc.upsertFlowSection("import", "CSVの取り込み", 0);
  const blocks: GeneratedBlock[] = [
    b({
      section: "s0",
      aspect: "tldr",
      md: "積読を数えて整理する小さなサービスである[[1]]。CSV を読み込み、ドライランで結果だけを確かめることもできる[[2]]。",
      claims: [
        { n: 1, kind: "architecture", quote: "", cites: [cite(IMPORTER, 10, 12)], checks: checks(), verdict: "verified" },
        { n: 2, kind: "behavior", quote: "", cites: [cite(IMPORTER, 14, 31)], checks: checks({ l1: "vacuous" }), verdict: "cited" },
      ],
    }),
    b({ section: "s1", aspect: "problem", md: "読みたい本を忘れないよう、積読の状態を 1 か所で管理する。" }),
    b({
      section: "s1",
      aspect: "users",
      kind: "list",
      depth: "L1",
      md: "- 読書家: 手元の本を CSV で一括登録する[[1]]\n- 運用者: ドライランで取り込み結果を確かめる[[2]]",
      claims: [
        { n: 1, kind: "behavior", quote: "", cites: [cite(IMPORTER, 14, 31)], checks: checks(), verdict: "verified" },
        { n: 2, kind: "behavior", quote: "", cites: [], checks: checks({ l0: false }), verdict: "inferred" },
      ],
    }),
    b({
      section: "s3/import",
      aspect: "summary",
      depth: "L1",
      md: "CSV の各行を読み、ISBN とタイトルが揃った行だけを積読として保存する[[1]]。重複は数えて飛ばす[[2]]。保存先は `BookRepo` である[[3]]。",
      claims: [
        { n: 1, kind: "behavior", quote: "", cites: [cite(IMPORTER, 17, 31)], checks: checks(), verdict: "verified" },
        { n: 2, kind: "edge_case", quote: "", cites: [cite(IMPORTER, 24, 27)], checks: checks(), verdict: "stale" },
        { n: 3, kind: "fact", quote: "", cites: [cite("src/db/repo.ts", 1, 30)], checks: checks({ l2: false }), verdict: "unsupported" },
      ],
    }),
    b({
      section: "s3/import",
      aspect: "sequence",
      kind: "diagram",
      depth: "L2",
      md: "```mermaid\nsequenceDiagram\n  participant cli as CLI\n  participant imp as importCsv\n  participant repo as BookRepo\n  cli->>imp: CSV text\n  imp->>repo: create\n  imp->>cli: ImportResult\n```",
      diagram: {
        kind: "sequence",
        direction: "RIGHT",
        origin: "ai",
        nodes: [
          { id: "cli", label: "CLI" },
          { id: "imp", label: "importCsv", sublabel: "services/importer.ts" },
          { id: "repo", label: "BookRepo" },
        ],
        edges: [
          { id: "e1", from: "cli", to: "imp", kind: "message", seq: 1, label: "CSV text" },
          { id: "e2", from: "imp", to: "repo", kind: "message", seq: 2, label: "create" },
          { id: "e3", from: "imp", to: "cli", kind: "message", seq: 3, label: "ImportResult" },
        ],
        groups: [],
      },
    }),
    b({
      section: "s3/import",
      aspect: "steps",
      kind: "list",
      depth: "L2",
      audience: ["dev", "reviewer"],
      md: "1. `parseCsvRecords` が行を取り出す[[1]]。\n2. ISBN かタイトルが無い行はエラーに数える[[2]]。\n3. 既存の ISBN は `skipped` に数える[[3]]。\n4. `dryRun` でなければ `repo.create` で保存する[[4]]。",
      claims: [
        { n: 1, kind: "behavior", quote: "", cites: [cite(IMPORTER, 15, 15)], checks: checks(), verdict: "verified" },
        { n: 2, kind: "edge_case", quote: "", cites: [cite(IMPORTER, 18, 21)], checks: checks(), verdict: "verified" },
        { n: 3, kind: "edge_case", quote: "", cites: [cite(IMPORTER, 22, 25)], checks: checks(), verdict: "verified" },
        { n: 4, kind: "behavior", quote: "", cites: [cite(IMPORTER, 26, 28)], checks: checks(), verdict: "verified" },
      ],
    }),
    b({
      section: "s3/import",
      aspect: "edge_cases",
      kind: "list",
      depth: "L3",
      audience: ["reviewer", "dev"],
      md: "- 行番号は 1 行目がヘッダなので `i + 2` で数える[[1]]\n- 同じ ISBN が CSV 内に 2 回あっても 2 回目は取り込み前の一覧に無いので保存される[[2]]",
      claims: [
        { n: 1, kind: "edge_case", quote: "", cites: [cite(IMPORTER, 19, 19)], checks: checks(), verdict: "verified" },
        { n: 2, kind: "risk", quote: "", cites: [], checks: checks({ l0: false }), verdict: "inferred" },
      ],
    }),
    b({
      section: "s9",
      aspect: "limits",
      kind: "pitfall",
      depth: "L3",
      audience: ["reviewer", "sre", "dev"],
      md: "取り込み前に `repo.list()` を毎行呼ぶので、行数が増えると 2 乗で遅くなる[[1]]。",
      claims: [{ n: 1, kind: "performance", quote: "", cites: [cite(IMPORTER, 24, 24)], checks: checks(), verdict: "verified" }],
    }),
    b({
      section: "s10",
      aspect: "decision",
      kind: "why",
      depth: "L2",
      audience: ["reviewer", "dev", "pm"],
      md: "**なぜ 1 行ずつ保存するのか**\n\nCSV 全体を検証してから保存する案もあったが、途中の不正な行で全部が失敗する方が運用者に不親切なので、行ごとに数えて続ける[[1]]。",
      claims: [{ n: 1, kind: "architecture", quote: "", cites: [cite(IMPORTER, 17, 31)], checks: checks(), verdict: "verified" }],
    }),
  ];
  // the glossary is set BEFORE the prose here, so the store's `usedIn` is empty: the export must not depend on it
  d.doc.setGlossary([
    { term: "積読", yomi: "つんどく", en: "tsundoku", definition: "買ったが読んでいない本の山。このサービスが数える対象。" },
    { term: "ドライラン", yomi: "どらいらん", en: "dry run", definition: "保存せずに結果だけを数える実行。`dryRun` オプションで有効になる。" },
  ]);
  d.doc.applyGenerated(blocks, { mode: "write", deletes: [], source: { kind: "regen", id: "gr_00000001" }, reason: "e2e", listed: 0 });
  const req: ExportReq = { format: "html", level: "standard", lang: "ja", includeDecisions: false, excerpts: true };
  const res = await int.json<ExportRes>("POST", `/ws/${ws}/export`, req);
  writeFileSync(join(out, "rich.html"), res.html);
  const nocode = await int.json<ExportRes>("POST", `/ws/${ws}/export`, { ...req, excerpts: false });
  writeFileSync(join(out, "rich.nocode.html"), nocode.html);
  const dl = await int.cli("GET", `/ws/${ws}/export/html?level=expert&lang=en`);
  writeFileSync(join(out, "rich.en.html"), await dl.text());
  writeFileSync(
    join(out, "rich.json"),
    `${JSON.stringify({ bytes: res.bytes, sha256: res.sha256, redactions: res.redactions, codeExcerpts: res.codeExcerpts, nocodeBytes: nocode.bytes, download: { status: dl.status, type: dl.headers.get("content-type"), disposition: dl.headers.get("content-disposition") } }, null, 2)}\n`,
  );
  console.log(`rich: ${Math.round(res.bytes / 1024)} KB, ${res.codeExcerpts.count} excerpts / ${res.codeExcerpts.files} files → ${join(out, "rich.html")}`);
} finally {
  await int.close();
  await repo.dispose();
}
