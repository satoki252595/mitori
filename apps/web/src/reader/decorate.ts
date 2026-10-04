/**
 * Per-block client decoration (ux.md §4.3.4 / §12.7), run once per block mount or html change. Everything the
 * client adds INSIDE `.mb` carries `data-mx` (excluded from anchor text, AC-U30): the newcomer "出典 n" button
 * and the claim-check button `button.vsum` on blocks with a problematic claim. Verdict badges stay pseudo-elements.
 * Tables get column classes (short ⇒ never wraps, numeric ⇒ right-aligned) and, in static facts blocks, the
 * `path:line` code cells become cite chips (`a.fcite`, peeked through `GET /files/content`) — attributes and
 * wrappers only, so the block's text (ANCHOR_TEXT_RULES) stays exactly the server's.
 */
import type { BlockView, ReaderLevel } from "@mitori/core";

export interface DecorateText {
  citeEnd: (n: number) => string;
  verifyLabel: string;
  /** Code-view link of a fact cite (null without a workspace). */
  codeHref?: (path: string, start: number, end: number) => string | null;
}

const PROBLEM = new Set(["inferred", "unsupported", "stale"]);

export function decorateBlock(wrapper: HTMLElement, b: BlockView, level: ReaderLevel, text: DecorateText): void {
  const mb = wrapper.querySelector<HTMLElement>(":scope > .mb");
  if (!mb) return;
  // gutter ✓ (shown on hover / ⌥ / expert by CSS)
  const verdicts = b.claimViews.map((c) => c.verdict);
  if (verdicts.length && verdicts.every((v) => v === "verified" || v === "human-verified"))
    wrapper.dataset.v = verdicts.every((v) => v === "human-verified") ? "human" : "verified";
  else delete wrapper.dataset.v;
  // claim spans: screen-reader description of the badge (attribute only)
  for (const span of mb.querySelectorAll<HTMLElement>(".mc[data-verdict]")) {
    const v = span.dataset.verdict ?? "";
    if (PROBLEM.has(v)) span.setAttribute("aria-describedby", `sr-verdict-${v}`);
  }
  // newcomer: paragraph-end "出典 n"
  const cites = mb.querySelectorAll("a.mcite").length;
  if (cites > 0 && !mb.querySelector(".cite-end")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cite-end";
    btn.dataset.mx = "";
    btn.textContent = text.citeEnd(cites);
    const last = mb.lastElementChild;
    (last && /^(P|LI)$/.test(last.tagName) ? last : mb).appendChild(btn);
  }
  // claim check button only when the block has a problematic claim
  if (verdicts.some((v) => PROBLEM.has(v)) && !mb.querySelector("button.vsum")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vsum";
    btn.dataset.mx = "";
    btn.textContent = text.verifyLabel;
    const last = mb.lastElementChild;
    (last && /^(P|LI)$/.test(last.tagName) ? last : (last?.querySelector("li:last-child, p:last-child") ?? mb)).appendChild(btn);
  }
  for (const table of mb.querySelectorAll<HTMLTableElement>("table")) decorateTable(table, b.kind === "facts" ? (text.codeHref ?? null) : null);
  applyLevel(wrapper, level);
}

/** `<details>` defaults per level: Deep Dive open only for expert, Why open only for newcomer. */
export function applyLevel(root: ParentNode, level: ReaderLevel): void {
  for (const d of root.querySelectorAll<HTMLDetailsElement>("details.mdeep")) d.open = level === "expert";
  for (const d of root.querySelectorAll<HTMLDetailsElement>("details.why")) d.open = level === "newcomer";
}

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

/** Visual length: CJK and other wide characters count 2. */
export function visualLen(s: string): number {
  let n = 0;
  for (const c of s) n += WIDE.test(c) ? 2 : 1;
  return n;
}

/** A short cell never wraps: ≤ 12 columns (`test`, `未実行`, `ANY`, `Makefile:87`), or one token ≤ 24. */
export const SHORT_CELL = 12;
const SHORT_TOKEN = 24;
/** Break opportunities inside a long identifier / path of a table cell (after these characters). */
const SOFT_BREAK = /(?<=[/#.:_])/;
/** A number with an optional short unit (`4,611`, `12 ms`, `35%`, `3.4k`, or one or two CJK unit characters). */
const NUMERIC = /^[−+-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:%|[A-Za-z]{1,3}|\p{Script=Han}{1,2})?$/u;
const EMPTY = /^(?:|—|–|-)$/;

/** Column kinds of a table body: `num` (every filled cell numeric), `short` (every cell short), else null. */
export function columnKinds(rows: readonly (readonly string[])[], ncol: number): ("num" | "short" | null)[] {
  return Array.from({ length: ncol }, (_, c) => {
    const texts = rows.map((r) => (r[c] ?? "").trim());
    const filled = texts.filter((x) => !EMPTY.test(x));
    if (filled.length > 0 && filled.every((x) => NUMERIC.test(x))) return "num";
    if (texts.every((x) => visualLen(x) <= SHORT_CELL || (!/\s/.test(x) && visualLen(x) <= SHORT_TOKEN))) return "short";
    return null;
  });
}

const CITE_TEXT = /^((?:[\w.@+-]+\/)*[\w.@+-]+):(\d{1,6})(?:-(\d{1,6}))?$/;
const HOSTISH = /\.(?:com|org|net|io|dev|app|jp|co|local|localhost|internal)$/i;
const EXTLESS = /^(?:Makefile|GNUmakefile|Dockerfile|Containerfile|Justfile|Rakefile|Procfile|Gemfile|Vagrantfile|Caddyfile|Taskfile|Earthfile)$/;

/** `internal/server/server.go:224`, `Makefile:87` → path + range; `host:port` and bare words are not cites. */
export function factCite(text: string): { path: string; start: number; end: number } | null {
  const m = CITE_TEXT.exec(text.trim());
  if (!m) return null;
  const path = m[1] as string;
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (!path.includes("/") && (HOSTISH.test(base) || !(/\.[A-Za-z0-9]+$/.test(base) || EXTLESS.test(base)))) return null;
  const start = Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  return start >= 1 && end >= start ? { path, start, end } : null;
}

/** Column classes, soft breaks in long code cells and (facts tables, `codeHref`) cite chips — also used on doc proposals. */
export function decorateTable(table: HTMLTableElement, codeHref: ((path: string, start: number, end: number) => string | null) | null): void {
  if (table.dataset.dec !== undefined) return;
  table.dataset.dec = "";
  const head = [...table.querySelectorAll<HTMLElement>("thead th")];
  const body = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((tr) => [...tr.children] as HTMLElement[]);
  const ncol = Math.max(head.length, ...body.map((r) => r.length));
  const kinds = columnKinds(
    body.map((r) => r.map((td) => td.textContent ?? "")),
    ncol,
  );
  kinds.forEach((k, c) => {
    const th = head[c];
    // short headers never wrap one character per line (メソッド, test)
    if (th && visualLen((th.textContent ?? "").trim()) <= SHORT_CELL + 2) th.dataset.nw = "";
    if (!k) return;
    if (th) th.dataset.col = k;
    for (const r of body) {
      const td = r[c];
      if (td) td.dataset.col = k;
    }
  });
  // long identifiers / paths break after a separator (`internal/server/server.go#` | `Server.handle…`), never
  // inside a word: <wbr> adds no text
  for (const code of table.querySelectorAll<HTMLElement>("td code")) {
    const text = code.textContent ?? "";
    if (code.childElementCount > 0 || visualLen(text) <= SHORT_TOKEN || /\s/.test(text)) continue;
    const parts = text.split(SOFT_BREAK);
    if (parts.length < 2) continue;
    code.textContent = "";
    parts.forEach((p, i) => {
      if (i > 0) code.append(document.createElement("wbr"));
      code.append(p);
    });
  }
  if (!codeHref) return;
  for (const code of table.querySelectorAll<HTMLElement>("td > code:only-child")) {
    const text = code.textContent ?? "";
    const c = factCite(text);
    const href = c ? codeHref(c.path, c.start, c.end) : null;
    if (!c || !href) continue;
    const a = document.createElement("a");
    a.className = "fcite";
    a.href = href;
    a.dataset.cite = `${c.path}:${c.start}-${c.end}`;
    a.dataset.blob = "";
    // the directory is its own span the reader level may hide (the text content stays the same)
    const slash = c.path.lastIndexOf("/");
    if (slash > 0) {
      const dir = document.createElement("span");
      dir.className = "cd";
      dir.textContent = text.slice(0, slash + 1);
      code.textContent = text.slice(slash + 1);
      code.prepend(dir);
    }
    const td = code.parentElement;
    code.replaceWith(a);
    a.appendChild(code);
    if (td) td.dataset.cite = "";
  }
}
