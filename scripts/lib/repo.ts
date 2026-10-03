// Tiny repo helpers for scripts (tooling: may use Bun/Node APIs freely).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");

/** Tracked + untracked (not ignored) files that exist in the working tree, repo-relative. */
export function listFiles(...pathspecs: string[]): string[] {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return [...new Set(r.stdout.split("\0").filter(Boolean))].filter((p) => existsSync(join(ROOT, p))).sort();
}

export const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** Print `path:line:col rule message` lines and return the exit code. */
export function report(title: string, items: readonly { file: string; line: number; col: number; rule: string; message: string }[]): number {
  if (items.length === 0) {
    console.log(`${title}: ok`);
    return 0;
  }
  for (const v of items) console.error(`${v.file}:${v.line}:${v.col} ${v.rule} ${v.message}`);
  console.error(`${title}: ${items.length} violation(s)`);
  return 1;
}
