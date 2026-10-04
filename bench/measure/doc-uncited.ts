// EX-04: the share of factual sentences of a generated doc that carry no source (0 tokens). Usage:
//   scripts/nd bun bench/measure/doc-uncited.ts <docDir>/doc [--list]
// With the adjacent doc.index.json, only AI-origin blocks are counted (modules by default, --all for every file).
// Without a sidecar this is a legacy mixed-origin Markdown scan, not a measurement of AI-only quality.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { DocIndex } from "@mitori/core";
import { fragmentOf, parseDoc } from "../../packages/doc/src/codec/parse.ts";
import { uncitedSentences } from "../../packages/gen/src/line/mdscan.ts";

const input = process.argv[2];
if (!input) {
  console.error("usage: doc-uncited.ts <doc dir> [--list] [--all]");
  process.exit(2);
}
const dir = resolve(input);
const docDir = dirname(dir);
const indexPath = join(docDir, "doc.index.json");
const hasIndex = existsSync(indexPath);
const index = hasIndex ? (JSON.parse(readFileSync(indexPath, "utf8")) as DocIndex) : null;
if (
  hasIndex &&
  (index?.kind !== "mitori/doc-index" || index.schemaVersion !== 1 || !index.blocks || typeof index.blocks !== "object" || Array.isArray(index.blocks))
)
  throw new Error("doc.index.json must be a version 1 mitori/doc-index with block metadata");
console.log(
  `scope: ${index ? "AI-origin blocks from adjacent doc.index.json" : "legacy mixed-origin Markdown (no doc.index.json; not AI-only quality)"}; ${process.argv.includes("--all") ? "all files" : "modules only"}`,
);
const list = process.argv.includes("--list");
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".md")) files.push(p);
  }
};
walk(dir);
// the module pages by default (the generated body; the top sections mix static facts in) — `--all` for every file
if (!process.argv.includes("--all")) files.splice(0, files.length, ...files.filter((f) => f.includes("/modules/")));
let total = 0;
let uncited = 0;
let withCode = 0;
const rows: string[] = [];
for (const f of files.sort()) {
  let source = readFileSync(f, "utf8");
  if (index) {
    const file = relative(docDir, f);
    const lang = Object.values(index.blocks).find((b) => b.file === file)?.lang ?? "ja";
    const parsed = parseDoc(source, file, { lang, docFile: file, docDirAbs: docDir, rootAbs: dirname(docDir) }, (id) => index.blocks[id]?.kind);
    source = parsed.blocks
      .flatMap((b) =>
        b.id && index.blocks[b.id]?.origin === "ai" && index.blocks[b.id]?.file === file ? [fragmentOf({ id: b.id, kind: b.kindHint, md: b.md }, lang)] : [],
      )
      .join("\n\n");
  }
  // Preserve the existing prose exclusions, including NOTE / TIP wrappers restored by the codec.
  const md = source
    .replace(/<!-- b_[0-9a-z]{8} -->/g, "")
    .replace(/^> \[!(NOTE|TIP)\].*\n(?:>.*\n?)*/gm, "")
    // the static facts line of a module page (「ファイル 38 · 5799 行 · 重要度 0.43」)
    .replace(/^- (ファイル \d+ · |子モジュール \d+|Files? \d+ · ).*$/gm, "");
  const r = uncitedSentences(md);
  if (r.sentences === 0) continue;
  total += r.sentences;
  uncited += r.uncited.length;
  withCode += r.uncitedWithCode.length;
  rows.push(
    `${f.slice(dir.length + 1).padEnd(40)} ${String(r.sentences).padStart(4)} ${String(r.uncited.length).padStart(4)} ${String(r.uncitedWithCode.length).padStart(4)}`,
  );
  if (list) for (const s of r.uncitedWithCode) rows.push(`    ・${s.slice(0, 120)}`);
}
console.log(`${"file".padEnd(40)} sent  unc  code`);
for (const r of rows) console.log(r);
const pct = (n: number) => (total > 0 ? ((100 * n) / total).toFixed(1) : "0");
console.log(`total: ${total} sentences · uncited ${uncited} (${pct(uncited)} %) · uncited naming code ${withCode} (${pct(withCode)} %)`);
