// `mitori.eval-report/1` (testing spec §7.7): `summary.json` for machines, `summary.md` for the people who read the SLO table.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BillingMode } from "@mitori/core";
import type { TEST_FORMATS } from "@mitori/testkit";
import type { SloEntry } from "./slo.ts";
import type { TokenEfficiency } from "./tokens.ts";

export type ReportTier = "smoke" | "quick" | "standard" | "full";

export interface SuiteCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface SuiteResult {
  id: string;
  /** `pending`: registered but not implemented yet (the report says which milestone brings it). */
  status: "ok" | "failed" | "partial" | "pending";
  checks: SuiteCheck[];
  metrics: Record<string, number>;
  notes: string[];
}

export interface EvalReport {
  v: typeof TEST_FORMATS.evalReport;
  tier: ReportTier;
  engine: "fake" | "claude-cli" | "offline";
  /** The run stopped early (budget) or a suite was skipped. */
  partial: boolean;
  startedAt: string;
  finishedAt: string;
  git: { sha: string; dirty: boolean };
  versions: { mitori: string; claude: string | null; prompts: Record<string, string>; pricing: string };
  corpus: { name: string; sha: string }[];
  budget: { capUsd: number; spentUsd: number; windowBefore: number | null; windowAfter: number | null; billing: BillingMode };
  suites: Record<string, SuiteResult>;
  slo: SloEntry[];
  /** Offline measurements, including explicit missing-provenance reasons. */
  tokenEfficiency?: TokenEfficiency[];
}

export function gitInfo(root: string): { sha: string; dirty: boolean } {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  return { sha: sha.status === 0 ? sha.stdout.trim() : "", dirty: dirty.status === 0 && dirty.stdout.trim() !== "" };
}

/** `20261003-a1b2c3d4e5f6-smoke` — the directory name of a report (§7.7). */
export function reportDirName(r: Pick<EvalReport, "tier" | "finishedAt" | "git">): string {
  const day = r.finishedAt.slice(0, 10).replaceAll("-", "");
  return `${day}-${(r.git.sha || "nosha").slice(0, 12)}-${r.tier}`;
}

const STATUS_JA: Record<SloEntry["status"], string> = { green: "達成", yellow: "警告", red: "未達", insufficient: "標本不足" };
const SUITE_JA: Record<SuiteResult["status"], string> = { ok: "成功", failed: "失敗", partial: "途中停止", pending: "未実装" };

const num = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 1 ? 4 : 2));
const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderMarkdown(r: EvalReport): string {
  const lines: string[] = [
    `# eval レポート: ${r.tier}${r.engine === "fake" ? "（fake engine）" : r.engine === "offline" ? "（オフライン集計）" : ""}`,
    "",
    `- 実行: ${r.startedAt} → ${r.finishedAt}`,
    `- git: \`${r.git.sha.slice(0, 12) || "(なし)"}\`${r.git.dirty ? "（未コミットの変更あり）" : ""}`,
    `- 予算: 上限 $${num(r.budget.capUsd)}（API 換算）／使用 $${num(r.budget.spentUsd)}／課金: ${r.budget.billing}${r.partial ? (r.engine === "offline" ? "／**未測定の項目あり**" : "／**途中で停止**") : ""}`,
    `- 価格表: ${r.versions.pricing}${r.versions.claude ? `／claude ${r.versions.claude}` : ""}`,
    "",
    "## SLO",
    "",
  ];
  if (r.slo.length === 0) lines.push("（この実行で判定した SLO はありません）", "");
  else {
    lines.push("| id | 値 | target | limit | 判定 | n | 備考 |", "|---|---|---|---|---|---|---|");
    for (const s of r.slo) {
      lines.push(
        `| ${cell(s.id)} | ${num(s.value)} ${s.unit} | ${num(s.target)} | ${num(s.limit)} | ${STATUS_JA[s.status]} | ${s.n ?? ""} | ${s.estimated ? `推計（分母を含む） ${cell(s.context ?? "")}` : s.synthetic ? "harness の自己検査" : s.bound !== undefined ? `Wilson 境界 ${num(s.bound)}` : ""} |`,
      );
    }
    lines.push("");
  }
  lines.push("## スイート", "");
  for (const s of Object.values(r.suites)) {
    lines.push(`### ${s.id} — ${SUITE_JA[s.status]}`, "");
    for (const n of s.notes) lines.push(`- ${n}`);
    if (s.notes.length) lines.push("");
    if (s.checks.length) {
      lines.push("| check | 結果 | 詳細 |", "|---|---|---|");
      for (const c of s.checks) lines.push(`| ${cell(c.id)} | ${c.ok ? "ok" : "**NG**"} | ${cell(c.detail)} |`);
      lines.push("");
    }
    const m = Object.entries(s.metrics);
    if (m.length) lines.push(m.map(([k, v]) => `${k} = ${num(v)}`).join("／"), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Write `<dir>/summary.json` and `<dir>/summary.md`; returns the paths. */
export function writeReport(dir: string, r: EvalReport): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const json = join(dir, "summary.json");
  const md = join(dir, "summary.md");
  writeFileSync(json, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(md, renderMarkdown(r));
  return { json, md };
}
