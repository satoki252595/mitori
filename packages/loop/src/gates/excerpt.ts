// Gate failure excerpt (spec §7.6.4): ≤ 60 lines and ≤ 1k tokens for repair prompts and the job card — ANSI
// stripped, worktree paths made repo-relative, the error-looking lines plus 2 lines after each, duplicates once,
// the last 40 lines when nothing matched, secrets redacted.
import { createSecretScanner, type SecretScanner } from "@mitori/core";
import { GATE_EXCERPT_LIMITS, GATE_EXCERPT_PATTERNS } from "../contract.ts";

// CSI (colours, cursor), OSC (titles, hyperlinks) and lone ESC sequences
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

let shared: SecretScanner | null = null;

/** Build the excerpt. */
export function excerpt(output: string, ctx: { worktree: string; estimateTokens(text: string): number }, secrets?: SecretScanner): string {
  const root = ctx.worktree.replace(/\/+$/, "");
  const lines = output
    .replace(ANSI_RE, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => (root === "" ? l : l.split(`${root}/`).join("").split(root).join(".")).replace(/\s+$/u, ""));
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (!GATE_EXCERPT_PATTERNS.some((re) => re.test(l))) return;
    for (let k = i; k <= Math.min(lines.length - 1, i + GATE_EXCERPT_LIMITS.contextAfter); k++) keep.add(k);
  });
  let picked = [...keep].sort((a, b) => a - b).map((i) => lines[i] as string);
  if (picked.length === 0) {
    const nonEmpty = lines.filter((l) => l.trim() !== "");
    picked = nonEmpty.slice(-GATE_EXCERPT_LIMITS.fallbackTailLines);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  let tokens = 0;
  for (const l of picked) {
    if (l.trim() !== "" && seen.has(l)) continue;
    seen.add(l);
    const t = ctx.estimateTokens(`${l}\n`);
    if (out.length >= GATE_EXCERPT_LIMITS.maxLines || tokens + t > GATE_EXCERPT_LIMITS.maxTokens) break;
    out.push(l);
    tokens += t;
  }
  shared ??= createSecretScanner();
  return (secrets ?? shared).redact(out.join("\n")).text;
}
