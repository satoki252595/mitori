/** Seeded generators for the anchor regression suites (AR2 synthetic mutations, AR6 fuzz, AR7 perf). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [lo, hi]. */
export function int(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

/** One element. */
export function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}

const WORDS = ["user", "session", "token", "cache", "items", "total", "config", "request", "result", "index", "value", "buffer", "count", "store", "path"];
const COMMENTS = [
  "// 認証トークンを検証する",
  "// TODO: リトライ回数を設定から読む 🚀",
  "// café と café は別の文字列",
  "# 日本語のコメント：ここでセッションを閉じる",
  "// handle the edge case where the list is empty",
  "/* 結合文字: が と が */",
];

/** A function-shaped block (`{`…`}`) with a unique-ish body. */
export function fnBlock(r: () => number, name: string, indent = ""): string[] {
  const out = [`${indent}function ${name}(${pick(r, WORDS)}, ${pick(r, WORDS)}) {`];
  const body = int(r, 2, 18);
  for (let i = 0; i < body; i++) {
    const k = r();
    if (k < 0.12) out.push("");
    else if (k < 0.22) out.push(`${indent}  ${pick(r, COMMENTS)}`);
    else if (k < 0.3) out.push(`${indent}  }`);
    else out.push(`${indent}  const ${pick(r, WORDS)}${int(r, 0, 999)} = ${pick(r, WORDS)}.${pick(r, WORDS)}(${int(r, 0, 99)});`);
  }
  out.push(`${indent}  return ${pick(r, WORDS)};`, `${indent}}`, "");
  return out;
}

/** A synthetic source file of about `fns` functions. */
export function codeFile(r: () => number, fns: number): string[] {
  const out = ["import { x } from './x';", ""];
  for (let i = 0; i < fns; i++) out.push(...fnBlock(r, `fn${i}_${int(r, 0, 99999)}`));
  return out;
}

const DECL_RE = /^(\s*)(?:export\s+|pub\s+|async\s+)*(?:function|func|fn|def|class|impl)\b/;

/** "Symbol bodies" of a line array (1-based, inclusive): brace blocks closed by `}` at the declaration's indent, Python by dedent. */
export function functions(lines: readonly string[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DECL_RE.exec(lines[i] as string);
    if (!m) continue;
    const indent = m[1] as string;
    const py = (lines[i] as string).trimEnd().endsWith(":");
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] as string;
      if (!py && l.trimEnd() === `${indent}}`) {
        end = j;
        break;
      }
      if (py && l.trim() !== "" && l.length - l.trimStart().length <= indent.length) break;
      if (py && l.trim() !== "") end = j;
    }
    if (end > i) out.push({ start: i + 1, end: end + 1 });
  }
  return out;
}

/** Real source files from the in-repo fixtures (deterministic material for AR2). */
export function fixtureSources(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|py|go|rs)$/.test(name)) {
        const text = readFileSync(p, "utf8");
        if (text.split("\n").length >= 30) out.push({ path: p.slice(root.length + 1), text });
      }
    }
  };
  walk(root);
  return out;
}
