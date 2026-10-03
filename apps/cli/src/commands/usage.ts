/** `mitori usage [--range today|7d|30d|month|all]`: tokens and their API-equivalent cost (`GET /usage/summary`). */
import type { UsageRange, UsageSummary, UsageTotals } from "@mitori/core";
import { oneOf, parse } from "./args.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { connect } from "./session.ts";

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
/** Terminal width of `s` (CJK and full-width forms take two columns). */
const width = (s: string) => [...s].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0);
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - width(s)));
const row = (label: string, t: UsageTotals) =>
  `${pad(label, 28)} ${String(t.calls).padStart(5)}  in ${k(t.in).padStart(6)}  cache ${k(t.cacheRead + t.cacheWrite).padStart(6)}  out ${k(t.out).padStart(6)}  $${t.apiUsd.toFixed(2)}\n`;

/** The usage table (engines, then models). */
export function usageText(u: UsageSummary, lang: "ja" | "en"): string {
  let t = lang === "ja" ? `使用量（${u.range}・API 換算）\n` : `usage (${u.range}, API-equivalent)\n`;
  t += row(lang === "ja" ? "合計" : "total", u.totals);
  for (const [engine, totals] of Object.entries(u.byEngine)) if (totals) t += row(`  ${engine}`, totals);
  for (const [model, totals] of Object.entries(u.byModel)) t += row(`  ${model}`, totals);
  const five = u.window?.fiveHour;
  if (five) t += lang === "ja" ? `5 時間枠: ${Math.round(five.utilization * 100)}%\n` : `5h window: ${Math.round(five.utilization * 100)}%\n`;
  return t;
}

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(io.argv, { range: { type: "string" } }, "usage");
  if (positionals.length > 0) throw usage(`unexpected argument ${positionals[0]}`, "mitori usage --help");
  const range: UsageRange = oneOf(values.range, ["today", "7d", "30d", "month", "all"] as const, "range", "usage") ?? "today";
  const s = await connect(io);
  io.out(usageText(await s.api.call("GET /usage/summary", { params: {}, query: { range } }), helpLang(io.env)));
  return 0;
}
