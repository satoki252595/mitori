// `bun e2e/export/support/compare.ts <exportShotsDir> <outDir>` — side-by-side composites for docs/progress/export/: the
// editorial prototype's shot (docs/design/prototypes/editorial/shots, left) next to the same state of the export (right).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const [shotsArg, outArg] = process.argv.slice(2);
if (!shotsArg || !outArg) throw new Error("usage: compare.ts <exportShotsDir> <outDir>");
const shots = resolve(shotsArg);
const out = resolve(outArg);
const proto = resolve(import.meta.dirname, "../../../docs/design/prototypes/editorial/shots");
mkdirSync(out, { recursive: true });

/** [composite name, prototype shot, export shot, what to look at] */
const PAIRS: [string, string, string][] = [
  ["compare-01-reader-standard", "02-reader-standard.png", "crit-02-reader-standard-flows.png"],
  ["compare-02-cite-peek", "02b-reader-peek.png", "crit-03-cite-peek.png"],
  ["compare-03-newcomer", "02c-reader-newcomer.png", "crit-05-reader-newcomer.png"],
  ["compare-04-expert", "02d-reader-expert.png", "crit-06-reader-expert.png"],
  ["compare-05-palette", "05-palette-romaji.png", "crit-09-palette.png"],
  ["compare-06-dark", "06-reader-dark.png", "crit-10-dark.png"],
  ["compare-07-map", "01-first-run-map.png", "crit-07-map.png"],
];

const work = mkdtempSync(join(tmpdir(), "mitori-compare-"));
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 2880, height: 900 }, deviceScaleFactor: 1 });
for (const [name, a, b] of PAIRS) {
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;display:flex;background:#888;gap:0}figure{margin:0;position:relative;width:1440px;height:900px;overflow:hidden}img{width:1440px;display:block}figcaption{position:absolute;left:8px;bottom:8px;font:600 15px system-ui;color:#fff;background:#000a;padding:4px 10px;border-radius:5px}</style>
<figure><img src="file://${join(proto, a)}"><figcaption>prototype · ${a}</figcaption></figure><figure><img src="file://${join(shots, b)}"><figcaption>export · ${b}</figcaption></figure>`;
  const file = join(work, `${name}.html`);
  writeFileSync(file, html);
  await page.goto(`file://${file}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(name);
}
await browser.close();
