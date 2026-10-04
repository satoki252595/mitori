// `bun run size`, second half (MILESTONES WP-12): the served-bytes budgets of the web shell — what a client downloads under
// `Accept-Encoding: br` / `gzip`, not the size of dist files (testing spec §6.5). Limit exceeded = exit 1.
//
//   bun bench/asset/size.ts [--url <base> | --dist <dir> | --bin <path> | --compiled] [--tree <checkout>] [--strict] [--json <file>] [--files]
//     (default)  start the daemon from source (`apps/cli/src/main.ts _serve`) on the last web build (dist/.build/web.json,
//                built by `bun scripts/gen-assets.ts` when missing) and measure it
//     --url      measure an already running server; only the assets its HTML requests are known
//     --dist     serve a built web directory with .br/.gz siblings in-process (tests, export viewer)
//     --bin      start this compiled binary instead of the source daemon; --compiled = dist/mitori-<os>-<arch>
//     (default mode also times `mitori --version` of dist/mitori-<host> against bin.startup; --no-startup skips it)
//     --strict   every asset limit is a hard gate (from M3); until then only the SC-21 hard set fails the run
//
// R1 [SC-21] (apps/web contract BUNDLE_BUDGETS): until M3 only the initial JS cap, the CSS cap and "no web font" are hard;
// the target of the initial JS and every chunk budget are warnings, as is the precompression rate.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Budgets, readBudgets } from "../runner/budgets.ts";
import { measureFactor } from "../runner/machine.ts";
import { textTable } from "../runner/table.ts";
import { fmt, judgeBudget, type Verdict } from "../runner/verdict.ts";
import { listDist, serveDist } from "./dist-server.ts";
import { type AssetMeasurement, type Metric, measureAssets } from "./measure.ts";
import { judgeStartup, measureStartup } from "./startup.ts";

const ROOT = resolve(import.meta.dir, "../..");

/** Budgets that fail the run before M3 (BUNDLE_BUDGETS comment, SC-21). */
export const HARD_UNTIL_M3: ReadonlySet<string> = new Set(["asset.js.initial.gz", "asset.css.gz", "asset.font"]);

export interface AssetVerdict extends Verdict {
  detail: string;
  /** Red and gating: fails the run. */
  hard: boolean;
}

export interface SizeReport {
  verdicts: AssetVerdict[];
  /** Metrics without a budget (e.g. a chunk the budgets do not know yet). */
  unbudgeted: Metric[];
  ok: boolean;
}

/** Turn metrics into verdicts. Time never enters: asset budgets are machine independent (`scale: "none"`). */
export function judgeAssets(metrics: readonly Metric[], budgets: Budgets, strict = false): SizeReport {
  const verdicts: AssetVerdict[] = [];
  const unbudgeted: Metric[] = [];
  for (const m of metrics) {
    const b = budgets.budgets.get(m.id);
    if (!b) {
      unbudgeted.push(m);
      continue;
    }
    if (b.unit !== m.unit) throw new Error(`${m.id}: measured in ${m.unit} but the budget is in ${b.unit}`);
    const v = judgeBudget(b, m.value, { factor: 1 });
    verdicts.push({ ...v, detail: m.detail, hard: v.level === "red" && v.gating && (strict || HARD_UNTIL_M3.has(m.id)) });
  }
  return { verdicts, unbudgeted, ok: verdicts.every((v) => !v.hard) };
}

export function renderSize(m: AssetMeasurement, r: SizeReport, files = false): string {
  const rows = r.verdicts.map((v) => [
    v.id,
    `${fmt(v.value)} ${v.unit}`,
    fmt(v.target),
    fmt(v.limit),
    v.level === "green" ? "ok" : v.hard ? "FAIL" : v.level === "red" ? "over limit (warning until M3)" : "over target (warning)",
  ]);
  const out = [textTable(["budget", "served", "target", "limit", "status"], rows)];
  for (const v of r.verdicts) if (v.level !== "green") out.push(`  ${v.id}: ${v.detail}`);
  for (const u of r.unbudgeted) out.push(`  (no budget) ${u.id} = ${fmt(u.value)} ${u.unit}`);
  for (const e of m.shell.external) out.push(`  warning: the shell references another origin: ${e}`);
  if (files) {
    out.push(
      "",
      textTable(
        ["file", "kind", "br", "gzip", "enc", "immutable"],
        m.rows.map((f) => [
          f.path + (f.initial ? " *" : ""),
          f.kind,
          String(f.br),
          String(f.gz),
          `${f.brEncoding ?? "-"}/${f.gzEncoding ?? "-"}`,
          f.immutable ? "yes" : "no",
        ]),
      ),
      "  (* = requested by the shell on a cold load)",
    );
  }
  return out.join("\n");
}

async function startSourceDaemon(bin: string | null, tree: string): Promise<{ url: string; stop(): Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "mitori-size-home-"));
  const argv = bin ? [bin, "_serve", "--port", "0"] : ["bun", join(tree, "apps/cli/src/main.ts"), "_serve", "--port", "0"];
  const proc = Bun.spawn(argv, { cwd: tree, env: { ...process.env, MITORI_HOME: home }, stdout: "pipe", stderr: "pipe" });
  const stop = async () => {
    proc.kill("SIGTERM");
    await proc.exited;
    rmSync(home, { recursive: true, force: true });
  };
  const reader = proc.stdout.getReader();
  let out = "";
  const watchdog = setTimeout(() => proc.kill("SIGKILL"), 15_000); // a daemon that never prints its URL ends the read
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
      const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)?.[0];
      if (url) {
        reader.releaseLock();
        return { url, stop };
      }
    }
  } finally {
    clearTimeout(watchdog);
  }
  await stop();
  throw new Error(`the daemon printed no URL: ${out}${await new Response(proc.stderr).text()}`);
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      url: { type: "string" },
      dist: { type: "string" },
      bin: { type: "string" },
      compiled: { type: "boolean" },
      strict: { type: "boolean" },
      json: { type: "string" },
      files: { type: "boolean" },
      tree: { type: "string" },
      "no-startup": { type: "boolean" },
    },
  });
  const tree = values.tree ? resolve(values.tree) : ROOT; // the checkout whose build is measured (compare measures base this way)
  const budgets = readBudgets(tree);
  let server: { url: string; stop(): Promise<void> } | null = null;
  let url: string;
  let listing: string[] = [];
  try {
    if (values.url) {
      url = values.url.endsWith("/") ? values.url : `${values.url}/`;
    } else if (values.dist) {
      const dir = resolve(values.dist);
      if (!existsSync(join(dir, "index.html"))) throw new Error(`${dir}/index.html does not exist`);
      server = serveDist(dir);
      url = server.url;
      listing = listDist(dir);
    } else {
      const manifest = join(tree, "dist/.build/web.json");
      if (!existsSync(manifest)) {
        console.error("size: no web build yet — running scripts/gen-assets.ts");
        const gen = Bun.spawnSync(["bun", join(tree, "scripts/gen-assets.ts")], { cwd: tree, stdout: "inherit", stderr: "inherit" });
        if (gen.exitCode !== 0) throw new Error("scripts/gen-assets.ts failed");
      }
      listing = Object.keys(JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>);
      const bin = values.bin ? resolve(values.bin) : values.compiled ? join(tree, `dist/mitori-${process.platform}-${process.arch}`) : null;
      if (bin && !existsSync(bin)) throw new Error(`${bin} does not exist — run \`bun run build:bin\``);
      server = await startSourceDaemon(bin, tree);
      url = server.url;
    }
    const measured = await measureAssets(url, listing);
    const report = judgeAssets(measured.metrics, budgets, values.strict ?? false);
    console.log(renderSize(measured, report, values.files ?? false));
    if (values.json) {
      mkdirSync(dirname(resolve(values.json)), { recursive: true });
      writeFileSync(
        resolve(values.json),
        `${JSON.stringify({ v: "mitori.asset-size/1", url, metrics: measured.metrics, verdicts: report.verdicts, ok: report.ok }, null, 2)}\n`,
      );
    }
    console.log(report.ok ? "size: web assets ok" : "size: a served-bytes limit is exceeded");

    // bin.startup (a time budget): only when this run is about the repo's own build, not an arbitrary --url / --dist
    let startupOk = true;
    const host = join(tree, `dist/mitori-${process.platform}-${process.arch}`);
    const bin = values.bin ? resolve(values.bin) : host;
    const startupBudget = budgets.budgets.get("bin.startup");
    if (!values.url && !values.dist && !values["no-startup"] && startupBudget && existsSync(bin)) {
      const v = judgeStartup(measureStartup(bin), startupBudget, () => measureFactor(tree).factor);
      console.log(
        `bin.startup ${bin.slice(tree.length + 1) || bin}: median ${fmt(v.median)} ms (target ${v.target}, limit ${v.limit})${v.level === "green" ? " ok" : v.hard ? " FAIL" : v.skipped ? ` over the limit, not gating (skipped: ${v.skipped})` : v.level === "red" ? ` over the limit, not gating on this machine (factor ${fmt(v.factor ?? 1)})` : " over target (warning)"}`,
      );
      startupOk = !v.hard;
    }
    return report.ok && startupOk ? 0 : 1;
  } finally {
    await server?.stop();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`size: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
