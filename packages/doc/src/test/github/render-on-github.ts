// Acceptance helper (manual, needs network): render a sample doc written by the store with GitHub's own Markdown
// renderer (REST `POST /markdown`, mode `gfm`: GFM + alerts; file view differs only in soft line breaks), check that no block-ID
// comment is visible and that tables, fences, alerts and lists survive, and save the HTML + a screenshot.
//   scripts/nd bun packages/doc/src/test/github/render-on-github.ts <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BlockId, ClaimChecks } from "@mitori/core";
import { chromium } from "@playwright/test";
import type { GeneratedBlock } from "../../contract.ts";
import { harness, staticInputFromTruth } from "../harness.ts";

const out = process.argv[2] ?? "github-render";
mkdirSync(out, { recursive: true });

const h = harness();
h.store.applyStatic(staticInputFromTruth("ts-small"));
const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.overview@1", indexDigest: "0".repeat(16) } as const;
const checks: ClaimChecks = { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00.000Z" };
const cite = (path: string, start: number, end: number) => ({ path, start, end, blob: "a".repeat(40), snippet: "0".repeat(16), precision: "exact" as const });
const g = (over: Partial<GeneratedBlock>): GeneratedBlock => ({
  id: null,
  section: "s1",
  aspect: "problem",
  kind: "prose",
  depth: "L1",
  audience: ["newcomer"],
  lang: "ja",
  md: "",
  claims: [],
  gen,
  ...over,
});
const opts = { mode: "write" as const, deletes: [] as BlockId[], source: { kind: "regen" as const, id: "gr_00000001" }, reason: "sample", listed: 0 };
h.store.applyGenerated(
  [
    g({
      md: "買ったまま読んでいない本（積読）を、忘れずに消化できるようにする[[1]]。`BookRepo.create` が id を振る[[2]]。",
      claims: [
        { n: 1, kind: "behavior", quote: "", cites: [cite("src/index.ts", 1, 12)], checks, verdict: "verified" },
        { n: 2, kind: "behavior", quote: "", cites: [cite("src/db/repo.ts", 10, 20), cite("src/db/types.ts", 3, 3)], checks, verdict: "verified" },
      ],
    }),
    g({ aspect: "users", kind: "list", md: "- 本を買いすぎる人\n- 読書会の幹事\n  - 入れ子の項目も崩れない" }),
    g({
      aspect: "constraints",
      kind: "list",
      md: "- 再試行は 1 回だけ[[1]]。",
      claims: [{ n: 1, kind: "invariant", quote: "", cites: [], checks, verdict: "inferred" }],
    }),
  ],
  opts,
);
h.store.applyGenerated([g({ section: "s3", aspect: "intro", md: "読み込みから一覧表示までの流れ。表・コード・図・注意書きの見え方の確認用。" })], opts);
h.store.upsertFlowSection("import", "CSV の取り込み", 0);
h.store.applyGenerated(
  [
    g({ section: "s3/import", aspect: "summary", md: "CSV を読み、`BookRepo` に保存する。" }),
    g({
      section: "s3/import",
      aspect: "sequence",
      kind: "diagram",
      depth: "L2",
      md: "取り込みの順序",
      diagram: {
        kind: "sequence",
        nodes: [
          { id: "cli", label: "CLI" },
          { id: "repo", label: "BookRepo" },
        ],
        edges: [{ id: "m1", from: "cli", to: "repo", kind: "message", label: "create(book)", seq: 1 }],
        groups: [],
        direction: "RIGHT",
        origin: "ai",
      },
    }),
    g({ section: "s3/import", aspect: "steps", kind: "list", md: "1. CSV を読む\n2. 行を検証する\n3. 保存する" }),
    g({ section: "s3/import", aspect: "edge_cases", kind: "list", md: "- 空の CSV は何もしない\n- 重複した ISBN は `|` を含んでもエスケープされる" }),
  ],
  opts,
);
h.store.applyGenerated(
  [
    g({
      section: "s10",
      aspect: "decision",
      kind: "why",
      depth: "L2",
      md: "**なぜ 1 回だけ再試行するのか**\n長く待たせないため。失敗が続くなら利用者に知らせる方がよい。",
    }),
  ],
  opts,
);
await h.store.flush({ force: true });

const files = [
  "doc/00-tldr.md",
  "doc/01-what-why.md",
  "doc/02-floor-plan.md",
  "doc/03-key-flows.md",
  "doc/04-quickstart.md",
  "doc/07-data-model.md",
  "doc/10-decisions.md",
  "doc/modules/src-ui.md",
];
const md = files.map((f) => h.mem?.files.get(f) ?? "").join("\n");
writeFileSync(join(out, "sample.md"), md);

const res = await fetch("https://api.github.com/markdown", {
  method: "POST",
  headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "mitori-wp04-acceptance" },
  body: JSON.stringify({ text: md, mode: "gfm" }),
});
if (!res.ok) throw new Error(`GitHub markdown API: ${res.status} ${await res.text()}`);
const html = await res.text();
writeFileSync(join(out, "github.html"), html);

const text = html.replace(/<[^>]*>/g, "");
const count = (re: RegExp) => (md.match(re) ?? []).length;
const checksOut = {
  idCommentsInSource: count(/<!-- b_[0-9a-z]{8} -->/g),
  idCommentsVisible: (text.match(/b_[0-9a-hjkmnp-tv-z]{8}/g) ?? []).length + (text.includes("&lt;!--") ? 1 : 0),
  tablesInSource: count(/^\|---/gm),
  tablesRendered: (html.match(/<table/g) ?? []).length,
  fencesInSource: count(/^```[a-z]+$/gm),
  fencesRendered: (html.match(/<pre/g) ?? []).length,
  alertsInSource: count(/^> \[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]$/gm),
  alertsRendered: (html.match(/class="markdown-alert markdown-alert-/g) ?? []).length,
  citeLinks: (html.match(/href="[^"]*#L\d+(-L\d+)?"/g) ?? []).length,
};
console.log(JSON.stringify(checksOut, null, 2));
const ok =
  checksOut.idCommentsVisible === 0 &&
  checksOut.tablesRendered === checksOut.tablesInSource &&
  checksOut.fencesRendered >= checksOut.fencesInSource &&
  checksOut.alertsRendered === checksOut.alertsInSource;
writeFileSync(join(out, "checks.json"), `${JSON.stringify({ ...checksOut, ok }, null, 2)}\n`);

const page = `<!doctype html><html><head><meta charset="utf-8"><title>mitori doc on GitHub (WP-04)</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.css">
<style>body{margin:0;background:#fff}.markdown-body{box-sizing:border-box;max-width:980px;margin:0 auto;padding:45px}</style></head>
<body><article class="markdown-body">${html}</article></body></html>`;
writeFileSync(join(out, "github-page.html"), page);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1012, height: 900 }, deviceScaleFactor: 1 });
await tab.goto(`file://${resolve(out, "github-page.html")}`);
await tab.waitForLoadState("networkidle");
await tab.screenshot({ path: join(out, "github-render.png"), fullPage: true });
await browser.close();
console.log(ok ? "OK: ID comments invisible; tables, fences and alerts intact" : "FAILED");
process.exit(ok ? 0 : 1);
