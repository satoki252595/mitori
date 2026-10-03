// `--suite watch` (testing spec §8.5, CT-15): hash-watch the billing support article and the legal/headless/auth pages.
// A change is yellow: it is reported with the head of a line diff and the page snapshot is updated; a person decides
// what it means (stop Push, switch to Pull, update the README) and files the issue. Only the hashes are committed
// (`watch.json`); the text snapshots for the diff stay in the maintainer's cache (they are copies of third-party pages).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const WATCH_URLS = [
  "https://support.claude.com/en/articles/15036540",
  "https://code.claude.com/docs/en/legal-and-compliance",
  "https://code.claude.com/docs/en/headless",
  "https://code.claude.com/docs/en/authentication",
] as const;

const DIFF_LINES = 200;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** `<tag …>` … last `</tag>` (the page's main region), or null. */
function region(html: string, tag: string): string | null {
  const i = html.search(new RegExp(`<${tag}\\b`, "i"));
  const j = html.toLowerCase().lastIndexOf(`</${tag}>`);
  return i >= 0 && j > i ? html.slice(i, j) : null;
}

/**
 * HTML → stable text of the page's own content: the `<article>` (else `<main>`) region — site navigation lists every
 * other article and would flag unrelated pages — with scripts/styles/comments and tags removed, entities decoded,
 * whitespace collapsed per line and blank lines dropped. Block boundaries stay line breaks for a line diff.
 */
export function normalizePage(html: string): string {
  const text = (region(html, "article") ?? region(html, "main") ?? html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/pre|\/blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith("#x")) return String.fromCodePoint(Number.parseInt(k.slice(2), 16));
      if (k.startsWith("#")) return String.fromCodePoint(Number(k.slice(1)));
      return ENTITIES[k] ?? m;
    });
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/** Lines removed (`- `) and added (`+ `), in order, at most `max` of them (pages are small; no LCS needed). */
export function lineDiff(before: string, after: string, max = DIFF_LINES): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const inA = new Set(a);
  const inB = new Set(b);
  return [...a.filter((l) => !inB.has(l)).map((l) => `- ${l}`), ...b.filter((l) => !inA.has(l)).map((l) => `+ ${l}`)].slice(0, max);
}

export const slugOf = (url: string): string =>
  url
    .replace(/^https?:\/\//, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export interface WatchEntry {
  sha256: string;
  at: string;
}
export interface WatchFile {
  v: "mitori.contract-watch/1";
  pages: Record<string, WatchEntry>;
}
export interface WatchResult {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  diff?: string[];
}

const sha256 = (s: string): string => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** Fetch every page, compare with `watch.json`, update the snapshots. Never throws. */
export async function runWatch(opts: {
  /** Directory of `watch.json` (committed hashes). */
  dir: string;
  /** Text snapshots for the diff (default `$XDG_CACHE_HOME/mitori-contract/watch`). */
  snapDir?: string;
  fetchText?: (url: string) => Promise<string>;
  now?: () => string;
  urls?: readonly string[];
}): Promise<WatchResult[]> {
  const file = join(opts.dir, "watch.json");
  const snapDir = opts.snapDir ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "mitori-contract", "watch");
  const now = opts.now ?? (() => new Date().toISOString());
  const fetchText =
    opts.fetchText ??
    (async (url: string) => {
      const r = await fetch(url, { headers: { "user-agent": "mitori-contract-watch/1" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
  const state: WatchFile = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as WatchFile) : { v: "mitori.contract-watch/1", pages: {} };
  mkdirSync(snapDir, { recursive: true });
  const out: WatchResult[] = [];
  for (const url of opts.urls ?? WATCH_URLS) {
    let text: string;
    try {
      text = normalizePage(await fetchText(url));
    } catch (err) {
      out.push({ id: `CT-15 ${url}`, status: "fail", detail: `fetch failed: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    if (text.length === 0) {
      out.push({ id: `CT-15 ${url}`, status: "fail", detail: "page has no text (blocked or rendered client-side)" });
      continue;
    }
    const hash = sha256(text);
    const prev = state.pages[url];
    const snap = join(snapDir, `${slugOf(url)}.txt`);
    if (prev?.sha256 === hash) {
      out.push({ id: `CT-15 ${url}`, status: "pass", detail: "unchanged" });
      continue;
    }
    const before = existsSync(snap) ? readFileSync(snap, "utf8") : "";
    writeFileSync(snap, `${text}\n`);
    state.pages[url] = { sha256: hash, at: now() };
    out.push(
      prev === undefined
        ? { id: `CT-15 ${url}`, status: "pass", detail: "baseline recorded" }
        : { id: `CT-15 ${url}`, status: "warn", detail: "page changed (contract-watch)", diff: lineDiff(before.trimEnd(), text) },
    );
  }
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return out;
}
