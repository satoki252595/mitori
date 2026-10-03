// Plain-text and Markdown tables for bench output (CI logs and PR comments).
export function textTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}

export function markdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const esc = (s: string) => s.replaceAll("|", "\\|");
  return [`| ${header.map(esc).join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
}
