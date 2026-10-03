/**
 * Static diff HTML (ux.md §6.6): the client builds ONE string from `FileDiff[]` and the panel inserts it once —
 * no component per line. Each line is one element + its text (2 DOM nodes): the old / new line numbers and the
 * `+` / `−` sign come from one padded `data-l` attribute rendered by CSS (copying a hunk copies only code), so a
 * 2,000-line diff stays ≈ 4k nodes. Word-level changes of paired `−`/`+` lines get `<span class="wd">`. No syntax
 * colours (they need the server diff HTML, CR ux-R7, M4). Every text goes through `esc`. Pure.
 */
import type { FileDiff, Hunk, HunkId } from "@mitori/core";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] as string);

/** Lines of a diff (hunk lines + one header per hunk and per file) — the CM6 threshold counts these. */
export function diffLineCount(files: readonly FileDiff[]): number {
  let n = 0;
  for (const f of files) {
    n += 1;
    for (const h of f.hunks) n += 1 + h.lines.length;
  }
  return n;
}

/** Common prefix / suffix of two lines (by UTF-16 unit, never splitting a surrogate pair). */
export function changedSpan(a: string, b: string): { pre: number; suf: number } {
  let pre = 0;
  const max = Math.min(a.length, b.length);
  while (pre < max && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;
  if (pre > 0 && pre < max && /[\uDC00-\uDFFF]/.test(a[pre] ?? "")) pre--;
  let suf = 0;
  while (suf < max - pre && a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)) suf++;
  return { pre, suf };
}

function wordHl(text: string, pre: number, suf: number): string {
  if (pre === 0 && suf === 0) return esc(text);
  const mid = text.slice(pre, text.length - suf);
  if (!mid || mid.length === text.length) return esc(text);
  return `${esc(text.slice(0, pre))}<span class="wd">${esc(mid)}</span>${esc(text.slice(text.length - suf))}`;
}

export interface DiffLabels {
  /** aria-label of ✓ for a hunk / file. */
  accept: string;
  /** aria-label of ✕. */
  reject: string;
  /** Binary file note. */
  binary: string;
}

interface Row {
  sign: " " | "+" | "-";
  text: string;
  o: number | null;
  n: number | null;
}

function rowsOf(h: Hunk): Row[] {
  const out: Row[] = [];
  let o = h.oldStart;
  let n = h.newStart;
  for (const l of h.lines) {
    const sign = (l[0] === "+" || l[0] === "-" ? l[0] : " ") as Row["sign"];
    const text = l.slice(1);
    if (sign === "+") out.push({ sign, text, o: null, n: n++ });
    else if (sign === "-") out.push({ sign, text, o: o++, n: null });
    else out.push({ sign, text, o: o++, n: n++ });
  }
  return out;
}

const pad = (v: number | null, w: number) => (v === null ? "" : String(v)).padStart(w, " ");
const MINUS = "−";

function hunkHtml(h: Hunk, w: number, labels: DiffLabels, limit: { left: number }): string {
  const rows = rowsOf(h);
  // pair runs of − with the following run of + for word-level highlight
  const spans = new Map<number, { pre: number; suf: number }>();
  for (let i = 0; i < rows.length; ) {
    if (rows[i]?.sign !== "-") {
      i++;
      continue;
    }
    let j = i;
    while (rows[j]?.sign === "-") j++;
    let k = j;
    while (rows[k]?.sign === "+") k++;
    const pairs = Math.min(j - i, k - j);
    for (let p = 0; p < pairs; p++) {
      const d = changedSpan((rows[i + p] as Row).text, (rows[j + p] as Row).text);
      spans.set(i + p, d);
      spans.set(j + p, d);
    }
    i = k;
  }
  const head = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
  let html = `<div class="hunk" data-hunk="${esc(h.id)}"><div class="hunk-h"><span class="hh mono">${esc(head)}</span><span class="dec"><button type="button" class="dbtn ok" data-act="accept" data-unit="${esc(h.id)}" aria-label="${esc(labels.accept)}">✓</button><button type="button" class="dbtn no" data-act="reject" data-unit="${esc(h.id)}" aria-label="${esc(labels.reject)}">✕</button></span></div>`;
  for (let i = 0; i < rows.length && limit.left > 0; i++, limit.left--) {
    const r = rows[i] as Row;
    const cls = r.sign === "+" ? "dl a" : r.sign === "-" ? "dl d" : "dl";
    const sign = r.sign === "-" ? MINUS : r.sign;
    const s = spans.get(i);
    const body = s ? wordHl(r.text, s.pre, s.suf) : esc(r.text);
    html += `<div class="${cls}" data-l="${pad(r.o, w)} ${pad(r.n, w)} ${sign}">${body || " "}</div>`;
  }
  return `${html}</div>`;
}

/**
 * The static HTML for `files`, or its first `maxLines` lines (the 2,000-line case shows 400 static lines until the
 * CM6 chunk arrives). Hunk / file buttons carry `data-act` + `data-unit` for ONE delegated click listener.
 */
export function renderDiffHtml(files: readonly FileDiff[], labels: DiffLabels, maxLines = Number.POSITIVE_INFINITY): string {
  const limit = { left: maxLines };
  let out = "";
  for (const f of files) {
    if (limit.left <= 0) break;
    let maxNo = 1;
    for (const h of f.hunks) maxNo = Math.max(maxNo, h.oldStart + h.oldLines, h.newStart + h.newLines);
    const w = String(maxNo).length;
    const name = f.oldPath && f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path;
    out += `<section class="dfile" data-path="${esc(f.path)}" style="--lnw:${w}ch"><header class="dfile-h"><span class="fp mono">${esc(name)}</span><span class="fs mono"><span class="ad">+${f.additions}</span> <span class="de">${MINUS}${f.deletions}</span></span><span class="dec"><button type="button" class="dbtn ok" data-act="accept" data-unit="file:${esc(f.path)}" aria-label="${esc(labels.accept)}">✓</button><button type="button" class="dbtn no" data-act="reject" data-unit="file:${esc(f.path)}" aria-label="${esc(labels.reject)}">✕</button></span></header>`;
    if (f.binary) out += `<p class="dbin">${esc(labels.binary)}</p>`;
    for (const h of f.hunks) {
      if (limit.left <= 0) break;
      out += hunkHtml(h, w, labels, limit);
    }
    out += "</section>";
  }
  return out;
}

/** Hunk ids of a file (file-level ✓ / ✕ decide every hunk of the file). */
export function hunksOfFile(files: readonly FileDiff[], path: string): HunkId[] {
  return files.find((f) => f.path === path)?.hunks.map((h) => h.id) ?? [];
}

/**
 * Old / new texts of one file for the CM6 merge view, reconstructed from its hunks (the API serves hunks, not
 * whole files): hunks joined by one `⋯` line, with the real new-side line numbers for the gutter.
 */
export function mergeTexts(f: FileDiff): { a: string; b: string; bLines: (number | null)[]; aLines: (number | null)[] } {
  const a: string[] = [];
  const b: string[] = [];
  const aLines: (number | null)[] = [];
  const bLines: (number | null)[] = [];
  f.hunks.forEach((h, i) => {
    if (i > 0) {
      a.push("⋯");
      b.push("⋯");
      aLines.push(null);
      bLines.push(null);
    }
    for (const r of rowsOf(h)) {
      if (r.sign !== "+") {
        a.push(r.text);
        aLines.push(r.o);
      }
      if (r.sign !== "-") {
        b.push(r.text);
        bLines.push(r.n);
      }
    }
  });
  return { a: a.join("\n"), b: b.join("\n"), aLines, bLines };
}
