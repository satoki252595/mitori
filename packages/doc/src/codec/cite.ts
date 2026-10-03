// Cite links ⇄ claim markers (§10.3) and the W07 marker normalization (§6.6-2).
import type { Cite, DocLang, LineNo, RepoPath } from "@mitori/core";
import { CITE_LINK_FORMAT, type CiteLinkGroup, CLAIM_MARKER_RE, type CodecContext } from "../contract.ts";
import { codeRanges, overlaps } from "./protect.ts";

const GROUP_RE: Record<DocLang, RegExp> = {
  ja: new RegExp(CITE_LINK_FORMAT.ja.groupRe, "g"),
  en: new RegExp(CITE_LINK_FORMAT.en.groupRe, "g"),
};
const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)#L(\d+)(?:-L(\d+))?\)/g;
const MARKER_RE = new RegExp(CLAIM_MARKER_RE, "g");
/** W07: a run of markers right after a sentence terminator (+ closing brackets) moves before the terminator. */
const W07_RE = /([。．！？!?.][」』）)"']*)((?:\[\[[1-9][0-9]?\]\])+)/g;

/**
 * Percent-encode the characters that would break the link grammar or the link itself: `%`, space and parentheses
 * (the destination), `#` (a fragment would cut the path) and `|` (a table cell boundary).
 */
export function encodeHrefPath(p: string): string {
  return p.replace(/[% ()#|]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** Decode percent escapes as UTF-8 (a hand-written `%E3%81%82` is `あ`); malformed sequences stay as written. */
function decodeHrefPath(p: string): string {
  if (!p.includes("%")) return p;
  return p.replace(/(?:%[0-9A-Fa-f]{2})+/g, (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}

/**
 * Link text of a cite label: Markdown punctuation is escaped so a basename like `__init__.py` is not emphasis and a
 * `|` does not split a table cell; `]` becomes `&#93;` because the cite-link grammar (`CITE_LINK_FORMAT.groupRe`)
 * forbids it inside the label (`[id].tsx` must still parse as a cite link).
 */
function labelText(s: string): string {
  return s.replace(/[\\`*_[\]<>&~|]/g, (c) => (c === "]" ? "&#93;" : `\\${c}`));
}

const isRelative = (href: string): boolean => !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("/") && !href.startsWith("#");

/** POSIX segments of an absolute path (no `.`/`..` resolution of the input beyond normalization). */
function segs(p: string): string[] {
  const out: string[] = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out;
}

/** Absolute docDir-joined path of the doc file's directory. */
function docDirSegs(ctx: CodecContext): string[] {
  const file = segs(`${ctx.docDirAbs}/${ctx.docFile}`);
  file.pop();
  return file;
}

/** Relative POSIX href from the doc file to a repo file (§10.3). */
export function citeHrefPath(path: RepoPath, ctx: CodecContext): string {
  const from = docDirSegs(ctx);
  const to = [...segs(ctx.rootAbs), ...segs(path)];
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  return [...new Array<string>(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

/** Repo path of a relative href written in `ctx.docFile` (a path escaping the root stays `../…` and fails L0). */
export function resolveCiteHref(hrefPath: string, ctx: CodecContext): RepoPath {
  const abs = segs([...docDirSegs(ctx), ...decodeHrefPath(hrefPath).split("/")].join("/"));
  const root = segs(ctx.rootAbs);
  let i = 0;
  while (i < root.length && abs[i] === root[i]) i++;
  return [...new Array<string>(root.length - i).fill(".."), ...abs.slice(i)].join("/");
}

/** Link label `<basename>:<start>-<end>` (`:<start>` for one line). */
export function citeLabel(c: { path: RepoPath; start: LineNo; end: LineNo }): string {
  const base = c.path.slice(c.path.lastIndexOf("/") + 1);
  return labelText(c.start === c.end ? `${base}:${c.start}` : `${base}:${c.start}-${c.end}`);
}

/** One rendered cite group (`（[a](b#L1)、…）` / ` ([a](b#L1), …)`; zero cites → inferred). */
export function renderGroup(cites: readonly { path: RepoPath; start: LineNo; end: LineNo }[], ctx: CodecContext): string {
  const f = CITE_LINK_FORMAT[ctx.lang];
  if (cites.length === 0) return f.inferred;
  const links = cites.map((c) => {
    const range = c.start === c.end ? `#L${c.start}` : `#L${c.start}-L${c.end}`;
    return `[${citeLabel(c)}](${encodeHrefPath(citeHrefPath(c.path, ctx))}${range})`;
  });
  return `${f.open}${links.join(f.sep)}${f.close}`;
}

/**
 * Cite-link groups → `[[k]]` (k by occurrence) outside code. Hrefs must be relative; `path` is the href path as
 * written (decoded) unless `ctx` is given, in which case it is resolved to a RepoPath.
 */
export function markerize(md: string, lang: DocLang, ctx?: CodecContext): { md: string; links: CiteLinkGroup[] } {
  const f = CITE_LINK_FORMAT[lang];
  if (!md.includes(lang === "ja" ? "（" : " (")) return { md, links: [] };
  const code = codeRanges(md);
  const links: CiteLinkGroup[] = [];
  let out = "";
  let at = 0;
  const re = GROUP_RE[lang];
  re.lastIndex = 0;
  for (let m = re.exec(md); m; m = re.exec(md)) {
    const text = m[0];
    if (overlaps(code, m.index, m.index + text.length)) continue;
    const cites: CiteLinkGroup["cites"] = [];
    const inferred = text === f.inferred;
    if (!inferred) {
      let bad = false;
      LINK_RE.lastIndex = 0;
      for (let l = LINK_RE.exec(text); l; l = LINK_RE.exec(text)) {
        const href = l[2] as string;
        if (!isRelative(href)) bad = true;
        const start = Number(l[3]);
        const end = l[4] === undefined ? start : Number(l[4]);
        cites.push({ path: ctx ? resolveCiteHref(href, ctx) : decodeHrefPath(href), start, end });
      }
      if (bad) continue;
    }
    links.push({ k: links.length + 1, cites, inferred });
    out += `${md.slice(at, m.index)}[[${links.length}]]`;
    at = m.index + text.length;
  }
  return links.length === 0 ? { md, links } : { md: out + md.slice(at), links };
}

/**
 * Cite-link groups written literally into marker-form md (`（推測）` as text, a cite link the LLM wrote itself): the
 * file would read them back as claims, so they become markers numbered from `from` (existing markers untouched).
 */
export function literalGroups(markerMd: string, lang: DocLang, ctx: CodecContext, from: number): { md: string; links: CiteLinkGroup[] } {
  if (!markerMd.includes(lang === "ja" ? "（" : " (")) return { md: markerMd, links: [] };
  // hide the existing markers so markerize numbers only the literal groups
  const hidden = markerMd.replace(MARKER_RE, (_all, n: string) => `\uE010${n}\uE011`);
  const { md, links } = markerize(hidden, lang, ctx);
  if (links.length === 0 || from + links.length - 1 > 99) return { md: markerMd, links: [] };
  const renumbered = md.replace(MARKER_RE, (_all, k: string) => `[[${from + Number(k) - 1}]]`).replace(/\uE010(\d+)\uE011/g, "[[$1]]");
  return { md: renumbered, links: links.map((l) => ({ ...l, k: from + l.k - 1 })) };
}

/** W07 normalization (outside code). */
export function normalizeMarkers(md: string): string {
  if (!md.includes("[[")) return md;
  const code = codeRanges(md);
  // a pass can leave a marker behind the previous terminator (`e.g.[[1]]！[[2]]` → `e.g[[1]].[[2]]！`): repeat to the
  // fixed point (moves swap equal-length runs, so the code ranges stay valid)
  let out = md;
  for (let i = 0; i < 16; i++) {
    const next = out.replace(W07_RE, (all, term: string, markers: string, off: number) => (overlaps(code, off, off + all.length) ? all : `${markers}${term}`));
    if (next === out) break;
    out = next;
  }
  return out;
}

/** `[[n]]` → rendered cite group of claim n (after W07). Unknown n renders as inferred. */
export function unmarkerize(markerMd: string, claims: readonly { n: number; cites: readonly Cite[] }[], ctx: CodecContext): string {
  const md = normalizeMarkers(markerMd);
  if (!md.includes("[[")) return md;
  const byN = new Map(claims.map((c) => [c.n, c.cites] as const));
  const code = codeRanges(md);
  return md.replace(MARKER_RE, (all, n: string, off: number) => (overlaps(code, off, off + all.length) ? all : renderGroup(byN.get(Number(n)) ?? [], ctx)));
}

/** Positions of markers outside code: `{ n, start, end }` in order. */
export function markerPositions(md: string): { n: number; start: number; end: number }[] {
  if (!md.includes("[[")) return [];
  const code = codeRanges(md);
  const out: { n: number; start: number; end: number }[] = [];
  MARKER_RE.lastIndex = 0;
  for (let m = MARKER_RE.exec(md); m; m = MARKER_RE.exec(md)) {
    if (!overlaps(code, m.index, m.index + m[0].length)) out.push({ n: Number(m[1]), start: m.index, end: m.index + m[0].length });
  }
  return out;
}
