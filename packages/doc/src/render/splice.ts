// Serve-time fill of claim placeholders (PT-07, CONS-23): span `<span class="mc" data-claim data-verdict>` and cite
// chips `<a class="mcite" data-cite data-blob href=HREFS.code(…)>` from the CURRENT claims. Newcomer level puts
// chips at the end of the paragraph / list item / cell (`READER_LEVEL_RULES.newcomer.cites = paragraph_end`).
import { type Claim, HREFS, HTML_CONTRACT, READER_LEVEL_RULES, type ReaderLevel, type WorkspaceKey } from "@mitori/core";
import { escapeHtml } from "./mdit.ts";

const TOKEN_RE = /(\d+)|(\d+)|<\/(?:p|li|td|th|h[1-6])>/g;

function chips(c: Claim, ws: WorkspaceKey): string {
  let out = "";
  for (const ct of c.cites) {
    const base = ct.path.slice(ct.path.lastIndexOf("/") + 1);
    const range = ct.start === ct.end ? `${ct.start}` : `${ct.start}-${ct.end}`;
    out +=
      `<a class="${HTML_CONTRACT.cite.cls}" data-cite="${escapeHtml(`${ct.path}:${ct.start}-${ct.end}`)}" data-blob="${escapeHtml(ct.blob)}"` +
      ` href="${escapeHtml(HREFS.code(ws, ct.path, ct.start, ct.end))}"><span class="cs">${escapeHtml(`${base}:${ct.start}`)}</span>` +
      `<span class="cl">${escapeHtml(`${ct.path}:${range}`)}</span></a>`;
  }
  return out;
}

/** Fill placeholders of a cached body. Claims are the block's claims in marker order. */
export function spliceBody(body: string, claims: readonly Claim[], ws: WorkspaceKey, level: ReaderLevel): string {
  if (!body.includes("") && !body.includes("")) return body;
  const atEnd = READER_LEVEL_RULES[level].cites === "paragraph_end";
  let pending = "";
  const open = new Set<number>();
  const out = body.replace(TOKEN_RE, (all, s?: string, e?: string) => {
    if (s !== undefined) {
      const c = claims[Number(s) - 1];
      if (!c) return "";
      open.add(Number(s));
      return `<span class="${HTML_CONTRACT.claim.cls}" data-claim="${escapeHtml(c.id)}" data-verdict="${c.verdict}">`;
    }
    if (e !== undefined) {
      const k = Number(e);
      const c = claims[k - 1];
      const close = open.delete(k) ? "</span>" : "";
      if (!c) return close;
      if (!atEnd) return close + chips(c, ws);
      pending += chips(c, ws);
      return close;
    }
    if (pending === "") return all;
    const flushed = pending + all;
    pending = "";
    return flushed;
  });
  return out + pending;
}
