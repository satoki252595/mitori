// THROWAWAY (SC-02, REVIEW-LOG): an early number for "what does Pass 1 cost?" before the M2 measurement window (O1/O2,
// generation spec M-2) exists. A repo inventory + a regex skeleton stand in for the indexer output (the indexer needs the
// platform adapters of WP-01 to run; pass `--digest <json>` to feed its real output instead), and the module pages are
// written by lean `claude -p` calls — the same profile the product uses (agent spec I1–I14), driven directly.
//
//   bun bench/measure/pass1-proto.ts --repo <dir> [--model claude-sonnet-5-5] [--effort low] [--modules 10] [--concurrency 3]
//                                    [--digest <file>] [--out <report.json>]                     # dry run: a plan, 0 tokens
//   MITORI_LIVE=1 bun bench/measure/pass1-proto.ts --repo <dir> --run --max-usd 8 [--claude <bin>] # spends the subscription window
//
// A live run needs MITORI_LIVE=1, `--run` and `--max-usd` (API-equivalent cap; calls stop once it would be exceeded), and
// aborts when a call reports an API-key `apiKeySource` (metered billing: ask the user first, CLAUDE.md).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CLAUDE_ARGV, ENV_ALLOWLIST, ENV_DENYLIST } from "@mitori/agent";
import { CHARS_PER_TOKEN, type ClaudeModelId, PRICING, priceUsage } from "@mitori/core";
import { median, percentile } from "../runner/stats.ts";

/* ------------------------------------------------------------------------ inventory */

export interface ProtoFile {
  path: string;
  chars: number;
  tokens: number;
  /** Declaration lines (the skeleton stand-in). */
  skeleton: string[];
  module: string;
}

export interface ProtoModule {
  name: string;
  files: ProtoFile[];
  tokens: number;
}

const SOURCE = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cs",
  ".swift",
  ".svelte",
  ".vue",
  ".sh",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  "third_party",
  "testdata",
  ".next",
  "coverage",
]);
const LOCK = /(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock)$/;
const MAX_FILE_CHARS = 200_000;
const DECL =
  /^\s*(?:export\s+|pub(?:\([a-z]+\))?\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|default\s+)*(?:def|class|func|fn|type|interface|struct|enum|trait|impl|function|const|let|var|module|object|abstract class)\b/;

/** chars → tokens with the product's own (uncalibrated) factors; markdown is not part of the source inventory. */
export const tokensOf = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN["claude-v5"].code);

/** Source files of the repo (git-tracked when it is a repository, else a walk), text only, vendored paths out. */
export function inventory(repo: string): ProtoFile[] {
  const git = spawnSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" });
  let paths: string[];
  if (git.status === 0 && git.stdout) paths = git.stdout.split("\0").filter(Boolean);
  else {
    paths = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(repo, dir), { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(join(dir, e.name));
        } else if (e.isFile()) paths.push(join(dir, e.name));
      }
    };
    walk("");
  }
  const out: ProtoFile[] = [];
  for (const p of paths.sort()) {
    const segs = p.split("/");
    if (segs.some((s) => SKIP_DIRS.has(s)) || LOCK.test(p) || !SOURCE.has(extname(p).toLowerCase())) continue;
    const abs = join(repo, p);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    const text = readFileSync(abs, "utf8");
    if (text.length === 0 || text.length > MAX_FILE_CHARS || text.includes("\0")) continue;
    const lines = text.split("\n");
    if (lines.some((l) => l.length > 2000)) continue; // minified
    const skeleton = lines.filter((l) => DECL.test(l)).map((l) => l.trim().slice(0, 160));
    out.push({ path: p, chars: text.length, tokens: tokensOf(text.length), skeleton, module: moduleOf(p) });
  }
  return out;
}

/** `packages/foo/src/x.ts` → `packages/foo`; `src/foo/x.ts` → `src/foo`; `main.go` → `.`. */
export function moduleOf(path: string): string {
  const segs = path.split("/");
  if (segs.length === 1) return ".";
  const wrapper = new Set(["packages", "apps", "src", "internal", "cmd", "crates", "lib", "pkg", "services"]);
  return wrapper.has(segs[0] as string) && segs.length > 2 ? `${segs[0]}/${segs[1]}` : (segs[0] as string);
}

export function groupModules(files: readonly ProtoFile[]): ProtoModule[] {
  const by = new Map<string, ProtoFile[]>();
  for (const f of files) by.set(f.module, [...(by.get(f.module) ?? []), f]);
  return [...by]
    .map(([name, fs]) => ({ name, files: fs, tokens: fs.reduce((s, f) => s + f.tokens, 0) }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

/** Real indexer output, when someone has produced it: `{ files: [{ path, chars, tokens, skeleton: string[], module }] }`. */
export function loadDigest(path: string): ProtoFile[] {
  const doc = JSON.parse(readFileSync(path, "utf8")) as { files?: ProtoFile[] };
  if (!Array.isArray(doc.files)) throw new Error(`${path}: expected { "files": [...] }`);
  return doc.files;
}

/* ------------------------------------------------------------------------ prompts */

/** The stable part: the page contract and the repo pack (skeleton of the biggest files), cached across module calls. */
export const SYSTEM_PROMPT = `You write one module page of a design document for a code repository. Write Japanese Markdown for a new team member.
Cover: purpose, main flow, key types and functions (name them in backticks), configuration, and one caveat.
Every claim cites its source as (path:start-end). Do not speculate beyond the code shown. Output the page only.`;

const PACK_TOKENS = 10_000;
const BODY_TOKENS = 6_000;
/** Output size of a module page [仮]: replaced by the measured value (generation spec M-10). */
const PAGE_OUT_TOKENS = 2_500;

export function repoPack(files: readonly ProtoFile[], budgetTokens = PACK_TOKENS): string {
  const lines: string[] = [];
  let used = 0;
  for (const f of [...files].sort((a, b) => b.tokens - a.tokens)) {
    const block = [`=== ${f.path}`, ...f.skeleton.slice(0, 12).map((l) => `| ${l}`)].join("\n");
    const t = tokensOf(block.length);
    if (used + t > budgetTokens) continue; // a smaller file may still fit
    lines.push(block);
    used += t;
  }
  return lines.join("\n");
}

export function modulePrompt(mod: ProtoModule, repoDir: string): string {
  const parts = [`Module: ${mod.name}`, "", "Declarations:"];
  for (const f of mod.files) parts.push(`=== ${f.path}`, ...f.skeleton.slice(0, 40).map((l) => `| ${l}`));
  parts.push("", "Source of the largest files:");
  let used = 0;
  for (const f of [...mod.files].sort((a, b) => b.tokens - a.tokens)) {
    if (used + f.tokens > BODY_TOKENS) continue;
    const numbered = readFileSync(join(repoDir, f.path), "utf8")
      .split("\n")
      .map((l, i) => `${i + 1}|${l}`)
      .join("\n");
    parts.push(`=== ${f.path}`, numbered);
    used += f.tokens;
  }
  return parts.join("\n");
}

/* ---------------------------------------------------------------------------- plan */

export interface Plan {
  repo: string;
  model: ClaudeModelId;
  effort: string;
  files: number;
  naiveFullTokens: number;
  modules: { name: string; files: number; tokens: number; promptTokens: number }[];
  packTokens: number;
  estimate: { in: number; cacheWrite: number; cacheRead: number; out: number; usd: number };
  /** Estimated Pass-1 input over the whole inventory (the SLO `gen.ratio.inputNaive`, target ≤ 0.20). */
  inputRatio: number;
}

export function makePlan(repo: string, files: readonly ProtoFile[], opts: { model: ClaudeModelId; effort: string; modules: number }): Plan {
  const all = groupModules(files);
  const picked = all.slice(0, opts.modules);
  const pack = repoPack(files);
  const packTokens = tokensOf(pack.length) + tokensOf(SYSTEM_PROMPT.length);
  const modules = picked.map((m) => ({
    name: m.name,
    files: m.files.length,
    tokens: m.tokens,
    promptTokens: Math.min(m.tokens, BODY_TOKENS) + Math.min(m.files.reduce((s, f) => s + f.skeleton.length, 0) * 12, 2000),
  }));
  // the first call writes the pack to the 5-minute cache, the rest read it (§8.3 of the generation spec, optimistic)
  const fresh = modules.reduce((s, m) => s + m.promptTokens, 0);
  const calls = modules.length;
  const est = {
    in: fresh,
    cacheWrite: calls > 0 ? packTokens : 0,
    cacheRead: calls > 1 ? packTokens * (calls - 1) : 0,
    out: calls * PAGE_OUT_TOKENS,
    usd: 0,
  };
  est.usd = priceUsage(opts.model, { in: est.in, cacheWrite5m: est.cacheWrite, cacheWrite1h: 0, cacheRead: est.cacheRead, out: est.out }, false);
  const naiveFull = files.reduce((s, f) => s + f.tokens, 0);
  return {
    repo,
    model: opts.model,
    effort: opts.effort,
    files: files.length,
    naiveFullTokens: naiveFull,
    modules,
    packTokens,
    estimate: est,
    inputRatio: naiveFull === 0 ? 0 : (est.in + est.cacheWrite + est.cacheRead) / naiveFull,
  };
}

/* ------------------------------------------------------------------------ live run */

export interface CallReport {
  module: string;
  ok: boolean;
  error?: string;
  apiKeySource?: string;
  usage: { in: number; cacheWrite: number; cacheRead: number; out: number };
  apiUsd: number;
  reportedUsd: number | null;
  durationMs: number;
  /** Time to the first text delta. */
  ttftMs: number | null;
}

export interface LiveReport {
  v: "mitori.pass1-proto/1";
  plan: Plan;
  claude: string;
  maxUsd: number;
  spentUsd: number;
  stoppedEarly: boolean;
  calls: CallReport[];
  totals: { in: number; cacheWrite: number; cacheRead: number; out: number; apiUsd: number };
  makespanMs: number;
  ttftMs: { p50: number; p95: number } | null;
}

/**
 * The argv of the product's `generate` mode, straight from the agent contract (`CLAUDE_ARGV.common` + `.generate`, agent spec
 * I1–I14), so the measured profile cannot drift from the shipped one. `--setting-sources ""` (no user settings inherited).
 */
export function leanArgs(o: { model: string; effort: string; systemFile: string; maxBudgetUsd: number }): string[] {
  const values: Record<string, string> = {
    "{model}": o.model,
    "{effort}": o.effort,
    "{systemPromptFile}": o.systemFile,
    "{maxBudgetUsd}": o.maxBudgetUsd.toFixed(2),
    "{settingSources}": "",
  };
  return [...CLAUDE_ARGV.common, ...CLAUDE_ARGV.generate].map((a) => {
    if (!/^\{\w+\}$/.test(a)) return a;
    const v = values[a];
    if (v === undefined) throw new Error(`pass1-proto: no value for ${a} in CLAUDE_ARGV`);
    return v;
  });
}

/** The child's environment (I5): the contract's allowlist ∩ this process, minus the denylist and every MITORI_* variable. */
export function leanEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const deny = new Set<string>(ENV_DENYLIST);
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOWLIST) {
    const v = env[k];
    if (v !== undefined && !deny.has(k) && !k.startsWith("MITORI_")) out[k] = v;
  }
  return out;
}

async function callOnce(
  claude: string,
  mod: ProtoModule,
  o: { repo: string; model: ClaudeModelId; effort: string; systemFile: string; cap: number; cwd: string },
): Promise<CallReport> {
  const env: Record<string, string> = { ...leanEnv(), CLAUDE_CODE_PROMPT_CACHE_TTL: "5m" };
  const t0 = performance.now();
  const proc = Bun.spawn([claude, ...leanArgs({ model: o.model, effort: o.effort, systemFile: o.systemFile, maxBudgetUsd: o.cap })], {
    cwd: o.cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: modulePrompt(mod, o.repo) } })}\n`);
  proc.stdin.end();
  const report: CallReport = {
    module: mod.name,
    ok: false,
    usage: { in: 0, cacheWrite: 0, cacheRead: 0, out: 0 },
    apiUsd: 0,
    reportedUsd: null,
    durationMs: 0,
    ttftMs: null,
  };
  let buffer = "";
  const decoder = new TextDecoder();
  let aborted = false;
  for await (const chunk of proc.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // warnings and blank lines
      }
      if (ev.type === "system" && ev.subtype === "init") {
        report.apiKeySource = String(ev.apiKeySource ?? "");
        if (report.apiKeySource !== "none") {
          report.error = `apiKeySource is "${report.apiKeySource}": this would be metered billing`;
          aborted = true;
          proc.kill("SIGINT");
        }
      } else if (ev.type === "stream_event" && report.ttftMs === null) {
        const e = ev.event as { type?: string; delta?: { type?: string } } | undefined;
        if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") report.ttftMs = performance.now() - t0;
      } else if (ev.type === "result") {
        const u = (ev.usage ?? {}) as Record<string, number>;
        report.usage = {
          in: u.input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          out: u.output_tokens ?? 0,
        };
        report.reportedUsd = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : null;
        report.ok = ev.is_error !== true;
        if (!report.ok) report.error = String(ev.subtype ?? "error");
      }
    }
  }
  const code = await proc.exited;
  report.durationMs = performance.now() - t0;
  if (!report.ok && !report.error)
    report.error = aborted
      ? "aborted"
      : `claude exited ${code} without a result: ${(await new Response(proc.stderr).text()).trim().split("\n").slice(-2).join(" | ")}`;
  report.apiUsd = priceUsage(
    o.model,
    { in: report.usage.in, cacheWrite5m: report.usage.cacheWrite, cacheWrite1h: 0, cacheRead: report.usage.cacheRead, out: report.usage.out },
    false,
  );
  return report;
}

export async function runLive(
  plan: Plan,
  files: readonly ProtoFile[],
  o: { claude: string; maxUsd: number; concurrency: number; perCallCapUsd: number },
): Promise<LiveReport> {
  const modules = groupModules(files).slice(0, plan.modules.length);
  const dir = mkdtempSync(join(tmpdir(), "mitori-pass1-"));
  const systemFile = join(dir, "system.txt");
  const cwd = join(dir, "empty");
  mkdirSync(cwd);
  // I3: the system prompt states the (empty) working directory, like the product's
  writeFileSync(systemFile, `${SYSTEM_PROMPT}\nWorking directory: ${cwd}\n\nRepository declarations (pack):\n${repoPack(files)}\n`, { mode: 0o600 });
  const calls: CallReport[] = [];
  let spent = 0;
  let inFlightCap = 0;
  let stoppedEarly = false;
  let next = 0;
  const t0 = performance.now();
  const worker = async () => {
    for (;;) {
      const mod = modules[next];
      // a call is only started when the money already spent plus every call in flight (at its cap) still fits
      if (!mod || stoppedEarly) return;
      if (spent + inFlightCap + o.perCallCapUsd > o.maxUsd) {
        stoppedEarly = true;
        return;
      }
      next++;
      inFlightCap += o.perCallCapUsd;
      try {
        const r = await callOnce(o.claude, mod, { repo: plan.repo, model: plan.model, effort: plan.effort, systemFile, cap: o.perCallCapUsd, cwd });
        calls.push(r);
        spent += r.apiUsd;
        if (r.apiKeySource && r.apiKeySource !== "none") stoppedEarly = true;
      } finally {
        inFlightCap -= o.perCallCapUsd;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const ttfts = calls.map((c) => c.ttftMs).filter((x): x is number => x !== null);
  const sum = (f: (c: CallReport) => number) => calls.reduce((s, c) => s + f(c), 0);
  return {
    v: "mitori.pass1-proto/1",
    plan,
    claude: o.claude,
    maxUsd: o.maxUsd,
    spentUsd: spent,
    stoppedEarly,
    calls,
    totals: {
      in: sum((c) => c.usage.in),
      cacheWrite: sum((c) => c.usage.cacheWrite),
      cacheRead: sum((c) => c.usage.cacheRead),
      out: sum((c) => c.usage.out),
      apiUsd: spent,
    },
    makespanMs: performance.now() - t0,
    ttftMs: ttfts.length ? { p50: median(ttfts), p95: percentile(ttfts, 95) } : null,
  };
}

/* --------------------------------------------------------------------------- output */

const k = (n: number) => `${(n / 1000).toFixed(1)}k`;

export function renderPlan(p: Plan): string {
  return [
    `pass1-proto (dry run, 0 tokens) · ${basename(p.repo)} · ${p.model} effort ${p.effort}`,
    `  inventory: ${p.files} source files, ${k(p.naiveFullTokens)} tokens (naive full)`,
    `  repo pack: ${k(p.packTokens)} tokens (cached after the first call)`,
    `  ${p.modules.length} module pages:`,
    ...p.modules.map((m) => `    ${m.name.padEnd(32)} ${String(m.files).padStart(4)} files  ${k(m.tokens).padStart(7)} tok  prompt ≈ ${k(m.promptTokens)}`),
    `  estimate: in ${k(p.estimate.in)} + cache write ${k(p.estimate.cacheWrite)} + cache read ${k(p.estimate.cacheRead)}, out ${k(p.estimate.out)} → $${p.estimate.usd.toFixed(3)} API-equivalent`,
    `  input / naive full = ${p.inputRatio.toFixed(3)}  (SLO gen.ratio.inputNaive: target ≤ 0.20, limit 0.30)`,
    `  [仮] page output ${PAGE_OUT_TOKENS} tok, body budget ${BODY_TOKENS} tok per module; prices ${PRICING[p.model].outPerMTok} $/Mtok out`,
  ].join("\n");
}

export function renderLive(r: LiveReport): string {
  const ok = r.calls.filter((c) => c.ok).length;
  return [
    `pass1-proto (live) · ${basename(r.plan.repo)} · ${r.calls.length}/${r.plan.modules.length} calls (${ok} ok) · $${r.spentUsd.toFixed(3)} of $${r.maxUsd} API-equivalent${r.stoppedEarly ? " · stopped early" : ""}`,
    ...r.calls.map(
      (c) =>
        `    ${c.module.padEnd(32)} ${c.ok ? "ok " : "ERR"} in ${k(c.usage.in)} cw ${k(c.usage.cacheWrite)} cr ${k(c.usage.cacheRead)} out ${k(c.usage.out)}  $${c.apiUsd.toFixed(3)}  ${(c.durationMs / 1000).toFixed(1)} s${c.error ? `  ${c.error}` : ""}`,
    ),
    `  totals: in ${k(r.totals.in)} cache-write ${k(r.totals.cacheWrite)} cache-read ${k(r.totals.cacheRead)} out ${k(r.totals.out)}; makespan ${(r.makespanMs / 1000).toFixed(1)} s${r.ttftMs ? `; ttft p50 ${(r.ttftMs.p50 / 1000).toFixed(1)} s p95 ${(r.ttftMs.p95 / 1000).toFixed(1)} s` : ""}`,
    `  input / naive full = ${((r.totals.in + r.totals.cacheWrite + r.totals.cacheRead) / Math.max(1, r.plan.naiveFullTokens)).toFixed(3)}`,
  ].join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      repo: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      modules: { type: "string" },
      concurrency: { type: "string" },
      digest: { type: "string" },
      out: { type: "string" },
      run: { type: "boolean" },
      "max-usd": { type: "string" },
      "per-call-usd": { type: "string" },
      claude: { type: "string" },
    },
  });
  if (!values.repo) throw new Error("--repo <dir> is required");
  const repo = resolve(values.repo);
  if (!existsSync(repo)) throw new Error(`${repo} does not exist`);
  const model = (values.model ?? "claude-sonnet-5-5") as ClaudeModelId;
  if (!(model in PRICING)) throw new Error(`unknown model ${model} (full ids only)`);
  const files = values.digest ? loadDigest(resolve(values.digest)) : inventory(repo);
  if (files.length === 0) throw new Error(`no source files found in ${repo}`);
  const plan = makePlan(repo, files, { model, effort: values.effort ?? "low", modules: Number(values.modules ?? 10) });

  if (!values.run) {
    console.log(renderPlan(plan));
    if (values.out) writeOut(values.out, { v: "mitori.pass1-proto/1", plan });
    return 0;
  }
  if (process.env.MITORI_LIVE !== "1")
    throw new Error("a live run spends your subscription window: set MITORI_LIVE=1 (and see CLAUDE.md before using an API key)");
  const maxUsd = Number(values["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("--max-usd <API-equivalent $> is required with --run");
  const report = await runLive(plan, files, {
    claude: values.claude ?? "claude",
    maxUsd,
    concurrency: Number(values.concurrency ?? 3),
    perCallCapUsd: Number(values["per-call-usd"] ?? 0.5),
  });
  console.log(renderLive(report));
  if (values.out) writeOut(values.out, report);
  return report.calls.some((c) => c.apiKeySource && c.apiKeySource !== "none") ? 3 : report.calls.every((c) => c.ok) && report.calls.length > 0 ? 0 : 1;
}

function writeOut(path: string, doc: unknown): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), `${JSON.stringify(doc, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`pass1-proto: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
