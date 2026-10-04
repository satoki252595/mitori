/**
 * S1 hero data (prototype `01-first-run-map`, CR m1-26): the meta line and the LOC tiles from
 * `WorkspaceStatus.profile`, falling back to the scan summary while the profile is absent (older daemons, scans
 * in progress). Pure; words come from the injected `t`.
 */
import type { AreaStat, RepoProfile, ScanSummaryView, SourceLang } from "@mitori/core";
import { fmtInt, fmtLocShort } from "../shell/fmt.ts";

/**
 * NC-04 the 「文脈」 caption: the first sentence of a lede / README paragraph (a sentence end after 20 characters at
 * least, so 「v2. Works…」 is not cut at 「v2.」), at most `max` characters with an ellipsis.
 */
export function oneSentence(src: string, max = 120): string {
  if (!src) return "";
  const end = src.search(/[。！？]|[.!?](\s|$)/);
  const one = end > 20 ? src.slice(0, end + 1) : src;
  const chars = [...one];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : one;
}

/** Display names of source languages (proper nouns: the same in every UI language). */
export const LANG_NAMES: Record<SourceLang, string> = {
  typescript: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  jsx: "JSX",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  csharp: "C#",
  php: "PHP",
  generic: "",
};

const TOOLCHAIN_NAMES: Record<NonNullable<RepoProfile["toolchain"]>["name"], string> = {
  go: "Go",
  python: "Python",
  rust: "Rust",
  node: "Node",
  typescript: "TypeScript",
  deno: "Deno",
  bun: "Bun",
};

/** Forges whose `host/path` is also a browsable https URL. */
const FORGES = new Set(["github.com", "gitlab.com", "bitbucket.org", "codeberg.org", "sr.ht", "git.sr.ht"]);

export interface MetaItem {
  text: string;
  /** External link (known forges only). */
  href?: string;
  /** Text taken from the repository (`data-user-content`). */
  user?: boolean;
}

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * `github.com/owner/repo · Go 1.26 · MIT · 406875d（2026-10-02）`; without a profile
 * `Go · 64.9k LOC · 1,219ファイル · 406875d`.
 */
export function heroMeta(profile: RepoProfile | null, scan: ScanSummaryView | null, head7: string | null, t: T, lang: "ja" | "en" = "ja"): MetaItem[] {
  const out: MetaItem[] = [];
  if (profile?.remote) {
    const { host, path } = profile.remote;
    out.push({ text: `${host}/${path}`, user: true, ...(FORGES.has(host) ? { href: `https://${host}/${path}` } : {}) });
  }
  if (profile?.toolchain) out.push({ text: `${TOOLCHAIN_NAMES[profile.toolchain.name]} ${profile.toolchain.version}`, user: true });
  else {
    const primary = scan?.languages.find((l) => l.lang !== "generic")?.lang;
    if (primary) out.push({ text: LANG_NAMES[primary] });
  }
  if (!profile && scan) out.push({ text: `${fmtLocShort(scan.loc)} LOC` }, { text: t("map.strip.files", { n: fmtInt(scan.files, lang) }) });
  if (profile?.license) out.push({ text: profile.license.spdx, user: true });
  if (profile?.head) out.push({ text: t("map.hero.head", { commit: profile.head.commit.slice(0, 7), date: profile.head.date.slice(0, 10) }) });
  else if (head7) out.push({ text: head7 });
  return out;
}

/** Tiles: the profile's areas (≤ 4), else the largest source languages of the scan (≥ 2 % of the LOC). */
export function heroAreas(profile: RepoProfile | null, scan: ScanSummaryView | null): AreaStat[] {
  if (profile) return profile.areas.slice(0, 4);
  if (!scan || scan.loc <= 0) return [];
  return scan.languages
    .filter((l) => l.lang !== "generic" && l.loc >= scan.loc * 0.02)
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 4)
    .map((l) => ({ kind: "code" as const, lang: l.lang, loc: l.loc, files: l.files }));
}

/** The token / cost params of a finished generation (NC-11): `tok` is everything billed, `out` what the model wrote. */
export function generatedTokens(
  totals: { in: number; out: number; cacheRead: number; cacheWrite: number; apiUsd: number },
  fmtTok: (n: number) => string,
  fmtUsd: (usd: number) => string,
): { tok: string; out: string; usd: string } {
  return { tok: fmtTok(totals.in + totals.cacheRead + totals.cacheWrite + totals.out), out: fmtTok(totals.out), usd: fmtUsd(totals.apiUsd) };
}

/**
 * NC-02: the hero lede of a generated doc — the first model-written prose / list block of §0, as plain text (≤ 280
 * chars, cut at a sentence end), with its block id for the link. Null when §0 has no written text yet.
 */
export function ledeOf(blocks: readonly { id: string; kind: string; origin: string; html: string }[]): { text: string; block: string } | null {
  for (const b of blocks) {
    if (b.origin !== "ai" || (b.kind !== "prose" && b.kind !== "list")) continue;
    const text = b.html
      .replace(/<(sup|button)[^>]*class="[^"]*(cite|chip)[^"]*"[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<a [^>]*class="[^"]*cite[^"]*"[^>]*>[\s\S]*?<\/a>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/（\s*）|\(\s*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 10) continue;
    if (text.length <= 280) return { text, block: b.id };
    const cut = text.slice(0, 280);
    const end = cut.lastIndexOf("。");
    return { text: end > 60 ? cut.slice(0, end + 1) : `${cut.slice(0, 279)}…`, block: b.id };
  }
  return null;
}
