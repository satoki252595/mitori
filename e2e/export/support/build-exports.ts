// `bun e2e/export/support/build-exports.ts <outDir> [crit] [m3e-canvas] [secrets]` — for each case: a real daemon (source
// checkout, isolated MITORI_HOME) opens the prepared repo, the doc's prose arrives once the index is ready, the REAL CLI
// writes `<outDir>/<case>.html` (and `<case>.nocode.html`), and `<outDir>/<case>.json` records what it printed. The
// Playwright spec calls this once (beforeAll); run it by hand to look at an export.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildFixture, startTestDaemon } from "@mitori/testkit";
import { connect, settled, until } from "./daemon.ts";
import { bringDoc, bringSecretsDoc, plantSecrets, prepareDogfood, workDir } from "./prepare.ts";

export interface BuiltExport {
  case: string;
  file: string;
  nocode: string;
  /** What `mitori export --html` printed on stderr (the summary line). */
  summary: string;
  /** CLI wall time, ms. */
  ms: number;
  bytes: number;
  redactions: number;
  excerpts: number;
  files: number;
  /** Doc size the daemon had when exporting. */
  blocks: number;
  claims: number;
  verified: number;
}

const SUMMARY_EN = /exported: (\d+) KB · sha256 \w+ · (\d+) redaction\(s\) · (\d+) code excerpt\(s\) from (\d+) file/;
const SUMMARY_JA = /書き出しました: (\d+) KB · sha256 \w+ · 伏せ字 (\d+) 件 · コード抜粋 (\d+) 件（(\d+) ファイル）/;

export async function buildCase(name: string, out: string): Promise<BuiltExport | null> {
  const work = workDir(name);
  let repoPath: string | null;
  let cleanup = async () => {};
  if (name === "secrets") {
    const repo = await buildFixture("secrets");
    plantSecrets(repo.root);
    repoPath = repo.root;
    cleanup = () => repo.dispose();
  } else repoPath = prepareDogfood(name, work);
  if (!repoPath) return null;
  const daemon = await startTestDaemon({ repoPath, binary: process.env.MITORI_E2E_BINARY === "compiled" ? "compiled" : "source" });
  try {
    const api = await connect(daemon);
    await until(api, (c) => c.blocks > 0, "the static doc", 90_000);
    if (name === "secrets") bringSecretsDoc(repoPath);
    else bringDoc(repoPath, name);
    const base = (await api.counts()).blocks;
    const c = await settled(api, (x) => x.blocks > base && x.claims > 0, "the doc's prose to be imported");
    const file = join(out, `${name}.html`);
    const nocode = join(out, `${name}.nocode.html`);
    const a = await daemon.cli(["export", "--html", "-o", file], { timeoutMs: 120_000 });
    if (a.code !== 0) throw new Error(`mitori export failed (${a.code}):\n${a.stdout}\n${a.stderr}`);
    const b = await daemon.cli(["export", "--html", "--no-code", "-o", nocode], { timeoutMs: 120_000 });
    if (b.code !== 0) throw new Error(`mitori export --no-code failed (${b.code}):\n${b.stdout}\n${b.stderr}`);
    const m = SUMMARY_EN.exec(a.stderr) ?? SUMMARY_JA.exec(a.stderr);
    const n = (i: number) => Number(m?.[i] ?? 0);
    const built: BuiltExport = {
      case: name,
      file,
      nocode,
      summary: a.stderr.trim(),
      ms: a.ms,
      bytes: n(1) * 1024,
      redactions: n(2),
      excerpts: n(3),
      files: n(4),
      blocks: c.blocks,
      claims: c.claims,
      verified: c.verified,
    };
    writeFileSync(join(out, `${name}.json`), `${JSON.stringify(built, null, 2)}\n`);
    return built;
  } finally {
    await daemon.stop();
    await cleanup();
  }
}

if (import.meta.main) {
  const [outArg, ...cases] = process.argv.slice(2);
  const out = resolve(outArg ?? "test-results/export");
  mkdirSync(out, { recursive: true });
  for (const c of cases.length ? cases : ["crit", "m3e-canvas", "secrets"]) {
    const t0 = performance.now();
    const r = await buildCase(c, out);
    console.log(
      r
        ? `${c}: ${r.summary}\n  doc ${r.blocks} blocks / ${r.claims} claims / ${r.verified} verified · CLI ${Math.round(r.ms)} ms · total ${Math.round(performance.now() - t0)} ms → ${r.file}`
        : `${c}: skipped (corpus not fetched)`,
    );
  }
}
