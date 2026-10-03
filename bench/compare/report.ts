// The PR-comment table of a compare run (§6.7: `id | base | head | Δ% | cv | status`).
import { markdownTable } from "../runner/table.ts";
import { fmt, mark } from "../runner/verdict.ts";
import type { CompareReport, MetricRow } from "./compare.ts";

const STATUS: Record<MetricRow["status"], string> = {
  ok: "ok",
  improved: "improved — consider tightening the target",
  regressed: "**REGRESSED**",
  noisy: "noisy (cv > 25 %) — warning only",
  new: "new",
  error: "**ERROR**",
};

const pct = (d: number): string => `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} %`;

export function renderMarkdown(r: CompareReport): string {
  const out: string[] = [
    `### bench: head \`${r.head.sha.slice(0, 8) || "?"}\` vs base \`${r.base?.sha.slice(0, 8) ?? "—"}\` — ${r.fail ? "**FAIL**" : "pass"}`,
    "",
  ];
  if (r.rows.length > 0) {
    out.push(
      markdownTable(
        ["id", "unit", "base", "head", "Δ%", "cv (base / head)", "status"],
        r.rows.map((row) => {
          const j = row.judgement;
          return [
            row.id,
            row.unit,
            row.base ? fmt(row.base.median) : "—",
            row.head && !row.head.error ? fmt(row.head.median) : "—",
            j ? pct(j.delta) : "—",
            j ? `${fmt(j.cvB)} / ${fmt(j.cvH)}` : row.head ? fmt(row.head.cv) : "—",
            `${STATUS[row.status]}${row.reran ? " (re-measured)" : ""}${row.note ? ` — ${row.note}` : ""}`,
          ];
        }),
      ),
      "",
    );
  } else {
    out.push("No bench cases were selected.", "");
  }
  if (r.counters.length > 0) {
    out.push(
      markdownTable(
        ["counter", "base", "head", "status"],
        r.counters.map((c) => [
          c.id,
          c.base === null ? "—" : String(c.base),
          String(c.head),
          c.fail ? `**FAIL** (head > ${c.base === null ? "max" : "base"})${c.note ? ` — ${c.note}` : ""}` : c.allowed ? "raised with budget-change" : "ok",
        ]),
      ),
      "",
    );
  }
  if (r.assets.length > 0) {
    const delta = (a: { base: number | null; head: number }) => (a.base === null ? "—" : `${a.head - a.base >= 0 ? "+" : ""}${fmt(a.head - a.base)}`);
    out.push(
      markdownTable(
        ["asset", "base", "head", "Δ", "target", "limit", "status"],
        r.assets.map((a) => [
          a.id,
          a.base === null ? "—" : `${fmt(a.base)} ${a.unit}`,
          `${fmt(a.head)} ${a.unit}`,
          delta(a),
          fmt(a.target),
          fmt(a.limit),
          a.level === "green" ? "ok" : a.hard ? "**FAIL**" : a.level === "red" ? "over limit (warning until M3)" : "over target (warning)",
        ]),
      ),
      "",
    );
  }
  if (r.gate && (r.gate.verdicts.length > 0 || r.gate.errors.length > 0)) {
    out.push(
      markdownTable(
        ["budget", "value", "target", "limit", "status"],
        r.gate.verdicts.map((v) => [
          v.id,
          `${fmt(v.value)} ${v.unit}`,
          fmt(v.target),
          fmt(v.limit),
          `${mark(v.level)}${v.scaled ? " (scaled by machine factor)" : ""}${v.level === "red" && !v.gating ? " (not gating on this machine)" : ""}`,
        ]),
      ),
      "",
    );
  }
  if (r.warnings.length > 0) out.push(...r.warnings.map((w) => `- warning: ${w}`), "");
  return out.join("\n").trimEnd();
}
