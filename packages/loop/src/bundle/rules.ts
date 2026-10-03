import type { RepoPath } from "@mitori/core";
import { BUNDLE_LIMITS } from "../contract.ts";
import type { Estimator } from "./estimate.ts";
import { quote } from "./lines.ts";

/** One convention file that may be sliced into a bundle. */
export interface RuleSource {
  path: RepoPath;
  text: string;
}

/** The RULES part: the full slice (≤ 150 tokens), a one-line fallback, and what was adopted. */
export interface RulesSlice {
  /** `RULES <sources> <shown>/<total>`. */
  header: string;
  /** Quote lines of the adopted sections. */
  lines: string[];
  /** One quote line (first sentence of the best section, ≤ 120 chars) when the full slice is dropped. */
  oneLine: string[];
  shown: number;
  total: number;
}

interface Section {
  source: RepoPath;
  heading: string;
  body: string;
  order: number;
  score: number;
}

const STOP = new Set(["src", "lib", "index", "main", "pkg", "internal", "cmd", "app"]);
const LANG_WORDS: Record<string, string> = {
  go: "go|golang",
  ts: "typescript|ts|node|javascript",
  tsx: "typescript|react|tsx",
  js: "javascript|node",
  py: "python|py",
  rs: "rust|cargo",
};
const TOPICS = /\b(?:test|tests|lint|format|style|error|errors)\b|テスト|規約|エラー/iu;
const GENERAL = /\b(?:conventions?|style|guidelines?|rules?)\b|コーディング|規約|ルール/iu;

/** Split a Markdown file into sections at `#`–`###` headings (outside fences); `<important if="…">` blocks become sections too. */
function sections(source: RuleSource, startOrder: number): Section[] {
  const out: Section[] = [];
  let order = startOrder;
  const push = (heading: string, lines: string[]) => {
    const body = lines.join("\n").trim();
    if (body !== "" || heading !== "") out.push({ source: source.path, heading, body, order: order++, score: 0 });
  };
  let heading = "";
  let buf: string[] = [];
  let fence = false;
  let important: { cond: string; lines: string[] } | null = null;
  for (const line of source.text.split(/\r\n|\r|\n/u)) {
    if (important) {
      if (/<\/important>/iu.test(line)) {
        push(important.cond, important.lines);
        important = null;
      } else important.lines.push(line);
      continue;
    }
    if (/^\s*(?:```|~~~)/u.test(line)) fence = !fence;
    const imp = fence ? null : /^\s*<important\s+if="([^"]*)"\s*>/iu.exec(line);
    if (imp) {
      push(heading, buf);
      buf = [];
      heading = "";
      important = { cond: imp[1] as string, lines: [] };
      continue;
    }
    const h = fence ? null : /^#{1,3}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (h) {
      push(heading, buf);
      buf = [];
      heading = h[1] as string;
    } else buf.push(line);
  }
  push(heading, buf);
  return out;
}

function terms(paths: readonly RepoPath[]): { words: RegExp | null; lang: RegExp | null } {
  const words = new Set<string>();
  const langs = new Set<string>();
  for (const p of paths) {
    const segs = p.split("/");
    const file = segs[segs.length - 1] as string;
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
    for (const w of [...segs.slice(0, -1), stem, ext]) {
      const t = w.toLowerCase();
      if (t.length >= 2 && !STOP.has(t)) words.add(t.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
    }
    if (LANG_WORDS[ext]) langs.add(LANG_WORDS[ext] as string);
  }
  const wrap = (alts: Iterable<string>, flags = "iu") => {
    const a = [...alts];
    return a.length === 0 ? null : new RegExp(`(?<![A-Za-z0-9_])(?:${a.join("|")})(?![A-Za-z0-9_])`, flags);
  };
  return { words: wrap(words), lang: wrap(langs) };
}

/** Sentences of a text (CJK terminators anywhere, ASCII ones before a space or the end). */
function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if ("。．！？".includes(ch) || (".!?".includes(ch) && (i + 1 === text.length || text[i + 1] === " " || text[i + 1] === "\n"))) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

const squash = (body: string): string[] =>
  body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

/**
 * Slice the convention files for the write scope (spec §4.8): sections scored by overlap with the paths and the
 * language / topic, best first, up to `rulesMaxTokens`, the last one cut at a sentence boundary. Null when nothing scores.
 */
export function sliceRules(sources: readonly RuleSource[], writePaths: readonly RepoPath[], est: Estimator): RulesSlice | null {
  const all: Section[] = [];
  for (const s of sources) all.push(...sections(s, all.length));
  if (all.length === 0) return null;
  const { words, lang } = terms(writePaths);
  for (const s of all) {
    const hay = `${s.heading}\n${s.body}`;
    if (words?.test(hay)) s.score += 3;
    if (lang?.test(s.heading) || TOPICS.test(s.heading)) s.score += 2;
    if (GENERAL.test(s.heading)) s.score += 1;
  }
  const ranked = all.filter((s) => s.score > 0 && s.body !== "").sort((a, b) => b.score - a.score || a.order - b.order);
  if (ranked.length === 0) return null;

  const adopted: { section: Section; lines: string[] }[] = [];
  let spent = 0;
  for (const s of ranked) {
    const lines = squash(s.body);
    const cost = est.quote(quote(lines.join("\n")));
    if (spent + cost <= BUNDLE_LIMITS.rulesMaxTokens) {
      adopted.push({ section: s, lines });
      spent += cost;
      continue;
    }
    // Cut the last section at a sentence boundary so it fits.
    const parts = sentences(lines.join("\n"));
    const kept: string[] = [];
    for (const p of parts) {
      if (spent + est.quote(quote([...kept, p].join("\n"))) > BUNDLE_LIMITS.rulesMaxTokens) break;
      kept.push(p);
    }
    if (kept.length > 0) adopted.push({ section: s, lines: [kept.join(" ")] });
    break;
  }
  if (adopted.length === 0) return null;

  const bySource = new Map<RepoPath, string[]>();
  for (const { section } of adopted) {
    const names = bySource.get(section.source) ?? [];
    if (section.heading !== "") names.push(section.heading.replace(/\s+/gu, "_").slice(0, 24));
    bySource.set(section.source, names);
  }
  const src = [...bySource].map(([p, names]) => (names.length > 0 ? `${p}#${names.join(",")}` : p)).join(";");
  const first = sentences((ranked[0] as Section).body.replace(/\n+/gu, " "))[0] ?? "";
  const one = first.length > 120 ? `${first.slice(0, 119)}…` : first;
  return {
    header: `RULES ${src} ${adopted.length}/${all.filter((s) => s.body !== "").length}`,
    lines: adopted.flatMap((a) => quote(a.lines.join("\n"))),
    oneLine: one === "" ? [] : quote(one),
    shown: adopted.length,
    total: all.filter((s) => s.body !== "").length,
  };
}
