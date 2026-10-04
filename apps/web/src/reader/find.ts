/**
 * Mark the words of a ⌘K full-text hit inside the block the palette jumped to (NC-09): CSS Custom Highlight
 * `mitori-find` over DOM ranges (no DOM split, nothing to undo), cleared after a few seconds or by the next jump.
 * Cite chips and client chrome (`[data-mx]`) are skipped — the index never saw their text.
 */

/** Ranges of `words` (case-insensitive, within single text nodes) under `root`, at most `max`. */
export function findRanges(root: Element, words: readonly string[], max = 16): Range[] {
  const needles = [...new Set(words.map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0))].sort((a, b) => b.length - a.length);
  if (needles.length === 0) return [];
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest("a.mcite, a.fcite, [data-mx]") ?? null) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const out: Range[] = [];
  for (let n = walker.nextNode(); n && out.length < max; n = walker.nextNode()) {
    const text = (n.nodeValue ?? "").toLowerCase();
    const taken: [number, number][] = [];
    for (const w of needles) {
      let at = text.indexOf(w);
      while (at >= 0 && out.length < max) {
        const end = at + w.length;
        if (!taken.some(([a, b]) => at < b && end > a)) {
          taken.push([at, end]);
          const r = doc.createRange();
          r.setStart(n, at);
          r.setEnd(n, end);
          out.push(r);
        }
        at = text.indexOf(w, end);
      }
    }
  }
  return out;
}

type HighlightCtor = new (...r: Range[]) => unknown;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** Paint the ranges as `mitori-find` for `ms` (the next call replaces them). Returns how many were painted. */
export function paintFind(root: Element, words: readonly string[], ms = 4000): number {
  const H = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  const reg = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  if (!H || !reg) return 0;
  const ranges = findRanges(root, words);
  if (clearTimer) clearTimeout(clearTimer);
  if (ranges.length === 0) {
    reg.delete("mitori-find");
    return 0;
  }
  reg.set("mitori-find", new H(...ranges));
  clearTimer = setTimeout(() => reg.delete("mitori-find"), ms);
  return ranges.length;
}
