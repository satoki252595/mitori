/**
 * Doc proposals on the wire (ux.md §6.5, api `DocProposalView`): the AI's edit of a design-doc block shown IN the prose
 * as a word-level suggestion (`<del class="d">` / `<ins class="a">` over the PROPOSED text's own HTML, so lists, tables
 * and code spans keep their shape), and the standalone accept / reject routes.
 *
 * Accept writes through `DocStore.acceptProposal` inside the workspace write slot (3-way rebase when the block moved;
 * the block's human lock is kept, so a `human-edited` block stays protected from the next regeneration). A proposal of
 * a job still under review is decided in that job's Review panel (one accept, one checkpoint, one Undo) — not here.
 *
 * The human edit of a block (`POST /doc/blocks/:block/edit`, ux.md §5.5 — the Composer's 「設計書を直す」 and the Inbox's
 * 2-way choice) lives here too: `apply: "doc"` writes the human's Markdown (locked `human-edited`, cites re-stamped),
 * `apply: "code"` makes the code follow it (a doc_edit thread + the job estimate). A cite the edit would remove is
 * reported BEFORE anything is saved (UXP-20) unless `confirmDrop`.
 */
import {
  type BlockId,
  type Claim,
  type DocEditReq,
  type DocEditRes,
  type DocProposal,
  type DocProposalView,
  type JobId,
  type JobState,
  MitoriError,
  type Ok,
  type ProposalId,
} from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { RouteCtx, RouteHandlers } from "../routes/types.ts";
import { blockView } from "./views.ts";
import type { WorkspaceDomain } from "./workspace.ts";

/* ---- word-level suggestion HTML ---------------------------------------------------------------------------------- */

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] as string);
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENT[e.toLowerCase()] ?? whole;
  });

/** One CJK character, one word, one whitespace run or one other character (the unit a reader sees change). */
const TOKEN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])[\p{L}\p{N}_])+|\s+|[^\s\p{L}\p{N}_]/gu;
export const tokens = (text: string): string[] => text.match(TOKEN) ?? [];

/** Above this many token pairs the middle of a diff is shown as one replacement (O(n·m) stays bounded). */
const DIFF_CELLS_MAX = 1_500_000;

type Op = { k: "eq" | "del" | "ins"; t: string; seg: number };

/** Token diff of `a` → `b` (common prefix / suffix trimmed, LCS in between). `seg` = index into `bSeg` for kept / inserted tokens. */
export function diffTokens(a: readonly string[], b: readonly string[], bSeg: readonly number[] = b.map(() => 0)): Op[] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const A = a.slice(p, a.length - s);
  const B = b.slice(p, b.length - s);
  const out: Op[] = [];
  for (let i = 0; i < p; i++) out.push({ k: "eq", t: b[i] as string, seg: bSeg[i] ?? 0 });
  // a deleted token goes where the next kept / inserted token is (else after the last one)
  const segB = (j: number) => bSeg[p + j] ?? bSeg[p + j - 1] ?? 0;
  if (A.length * B.length > DIFF_CELLS_MAX) {
    for (const t of A) out.push({ k: "del", t, seg: segB(0) });
    for (const [j, t] of B.entries()) out.push({ k: "ins", t, seg: segB(j) });
  } else {
    const n = A.length;
    const m = B.length;
    const L = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i * (m + 1) + j] =
          A[i] === B[j] ? (L[(i + 1) * (m + 1) + j + 1] as number) + 1 : Math.max(L[(i + 1) * (m + 1) + j] as number, L[i * (m + 1) + j + 1] as number);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) {
        out.push({ k: "eq", t: B[j] as string, seg: segB(j) });
        i++;
        j++;
      } else if (i < n && (j >= m || (L[(i + 1) * (m + 1) + j] as number) >= (L[i * (m + 1) + j + 1] as number))) {
        // deletions first: 「~~old~~ new」 reads as a correction
        out.push({ k: "del", t: A[i] as string, seg: segB(j) });
        i++;
      } else {
        out.push({ k: "ins", t: B[j] as string, seg: segB(j) });
        j++;
      }
    }
  }
  for (let i = b.length - s; i < b.length; i++) out.push({ k: "eq", t: b[i] as string, seg: bSeg[i] ?? 0 });
  return out;
}

/** Text of an HTML fragment (tags dropped, entities decoded). */
export function htmlText(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ""));
}

/**
 * Suggestion-mode HTML: the NEW html with inserted words in `<ins class="a">` and the removed words of the old text in
 * `<del class="d">` where they stood. Only text nodes change; the markup of the proposed text is kept as rendered.
 */
export function suggestionHtml(oldHtml: string, newHtml: string): string {
  const parts = newHtml.split(/(<[^>]*>)/);
  const bTok: string[] = [];
  const bSeg: number[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) return;
    for (const t of tokens(decode(part))) {
      bTok.push(t);
      bSeg.push(i);
    }
  });
  const ops = diffTokens(tokens(htmlText(oldHtml)), bTok, bSeg);
  if (!ops.some((o) => o.k !== "eq")) return newHtml;
  // inside <pre> / <code>, a <del> would still be inside the code element: fine (it renders as struck code)
  const bySeg = new Map<number, Op[]>();
  for (const o of ops) bySeg.set(o.seg, [...(bySeg.get(o.seg) ?? []), o]);
  let out = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out += part;
      return;
    }
    const seg = bySeg.get(i);
    if (!seg) {
      out += part;
      return;
    }
    out += renderSegment(seg);
  });
  return out;
}

const isSpace = (o: Op) => o.k === "eq" && /^\s+$/.test(o.t);

/**
 * One text node: kept tokens as they are; every change span — changes with only whitespace between them — as ONE
 * `<del>` (old words) followed by ONE `<ins>` (new words), so 「~~a b c~~ x y z」 reads as a phrase, not word salad.
 */
function renderSegment(seg: readonly Op[]): string {
  let out = "";
  let i = 0;
  while (i < seg.length) {
    const o = seg[i] as Op;
    if (o.k === "eq") {
      out += escHtml(o.t);
      i++;
      continue;
    }
    let j = i + 1;
    for (;;) {
      let k = j;
      while (k < seg.length && isSpace(seg[k] as Op)) k++;
      if (k < seg.length && (seg[k] as Op).k !== "eq") j = k + 1;
      else break;
    }
    const span = seg.slice(i, j);
    const del = span
      .filter((x) => x.k !== "ins")
      .map((x) => x.t)
      .join("");
    const ins = span
      .filter((x) => x.k !== "del")
      .map((x) => x.t)
      .join("");
    if (del.trim() !== "") out += `<del class="d">${escHtml(del)}</del>`;
    if (ins.trim() !== "") out += `<ins class="a">${escHtml(ins)}</ins>`;
    else if (ins !== "") out += escHtml(ins);
    i = j;
  }
  return out;
}

/* ---- views ------------------------------------------------------------------------------------------------------- */

export interface ProposalViewCtx {
  doc: Pick<DocStore, "block">;
  renderMessage(md: string): string;
}

/** `DocProposalView` of one proposal: the proposed text's HTML and its suggestion-mode diff against the block as it is now. */
export function proposalView(c: ProposalViewCtx, p: DocProposal): DocProposalView {
  const html = p.op === "delete" ? "" : c.renderMessage(p.md);
  const cur = p.block ? c.doc.block(p.block) : null;
  const oldHtml = cur ? c.renderMessage(cur.md) : "";
  const diffHtml =
    p.op === "insert" || !cur
      ? suggestionHtml("", html)
      : p.op === "delete"
        ? `<del class="d">${escHtml(htmlText(oldHtml))}</del>`
        : suggestionHtml(oldHtml, html);
  return { ...p, html, diffHtml };
}

/* ---- human edits ------------------------------------------------------------------------------------------------- */

/** Percent-decoded Markdown (file-form cite links encode `%`, space, `()#|` in their paths). */
function decodedMd(md: string): string {
  return md.replace(/(?:%[0-9A-Fa-f]{2})+/g, (x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
}

/**
 * Claims the new Markdown no longer cites (UXP-20, checked before saving): a claim none of whose cited files is linked
 * (`…path#L…`) any more. A link whose range the human changed is an edited cite (re-stamped), not a dropped one;
 * claims without cites (`inferred`) have no link to lose.
 */
export function droppedClaims(claims: readonly Claim[], newMd: string): { claim: Claim["id"]; label: string }[] {
  const text = decodedMd(newMd);
  const out: { claim: Claim["id"]; label: string }[] = [];
  for (const c of claims) {
    if (c.cites.length === 0) continue;
    if (c.cites.some((ct) => text.includes(`${ct.path}#L`))) continue;
    out.push({ claim: c.id, label: claimLabel(c) });
  }
  return out;
}

/** `fetch.go:46-61` — the first cite of a claim (the 「出典が外れます」 list). */
function claimLabel(c: Claim): string {
  const ct = c.cites[0];
  if (!ct) return c.quote.slice(0, 24);
  return `${ct.path.slice(ct.path.lastIndexOf("/") + 1)}:${ct.start}${ct.end !== ct.start ? `-${ct.end}` : ""}`;
}

/* ---- routes ------------------------------------------------------------------------------------------------------ */

/** Job states whose proposals are decided in the job's Review panel (the job's accept takes them). */
const UNDER_REVIEW: readonly JobState[] = ["ready", "partially_accepted"];

export function proposalHandlers(env: { domain(ctx: RouteCtx): Promise<WorkspaceDomain> }): RouteHandlers {
  const pending = (x: WorkspaceDomain, id: ProposalId): DocProposal => {
    const p = x.doc.proposals().find((q) => q.id === id);
    if (!p) throw new MitoriError("E_NOT_FOUND", `proposal ${id} not found`, { params: { id } });
    if (p.state !== "pending") throw new MitoriError("E_PRECONDITION", `proposal ${id} is already ${p.state}`, { params: { id, state: p.state } });
    if (p.source.kind === "job") {
      const job = x.loop.jobs.get(p.source.id as JobId);
      if (job && UNDER_REVIEW.includes(job.state))
        throw new MitoriError("E_PRECONDITION", "this proposal belongs to a job under review: decide it in the job's Review panel", {
          params: { job: job.id },
          hint: "open the job's Review (r) and decide the doc proposal with the code",
        });
    }
    return p;
  };

  return {
    "POST /ws/:ws/doc/blocks/:block/edit": async (ctx) => {
      const x = await env.domain(ctx);
      const req = (ctx.body ?? {}) as Partial<DocEditReq>;
      const block = ctx.params.block;
      if (typeof req.baseHash !== "string") throw new MitoriError("E_INVALID_INPUT", "baseHash is required", { params: { field: "baseHash" } });
      if (typeof req.md !== "string") throw new MitoriError("E_INVALID_INPUT", "md must be a string", { params: { field: "md" } });
      if (req.apply !== "doc" && req.apply !== "code") throw new MitoriError("E_INVALID_INPUT", "apply must be doc|code", { params: { field: "apply" } });
      // the doc store parses the file form (cite links); the marker form is the LLM's, never a human's
      if (req.mdForm !== "file")
        throw new MitoriError("E_INVALID_INPUT", "mdForm must be file (cite links as in the doc file)", { params: { field: "mdForm" } });
      const cur = x.doc.block(block);
      if (!cur) throw new MitoriError("E_NOT_FOUND", `block ${block} not found`, { params: { block } });
      if (req.apply === "code") {
        const res = await x.loop.review.docEditToCode(block, req as DocEditReq);
        return res;
      }
      if (cur.hash !== req.baseHash) throw new MitoriError("E_DOC_BASE_MISMATCH", "the block changed since the edit started", { params: { block } });
      const before = x.doc.claims(block);
      const dropped = droppedClaims(before, req.md);
      if (dropped.length > 0 && req.confirmDrop !== true) {
        const res: DocEditRes = { dropped };
        return res;
      }
      const r = await x.doc.editBlock(block, req.baseHash, req.md, "human");
      const res: DocEditRes = { block: await blockView(x.view, r.block), checks: r.checks };
      // the store re-stamps a link whose range changed as a new claim; only a cited FILE nobody cites any more is lost
      const still = new Set(x.doc.claims(block).flatMap((c) => c.cites.map((ct) => ct.path)));
      const lost = r.dropped.flatMap((id) => before.filter((c) => c.id === id && !c.cites.some((ct) => still.has(ct.path))));
      if (lost.length > 0) res.dropped = lost.map((c) => ({ claim: c.id, label: claimLabel(c) }));
      return res;
    },
    "POST /ws/:ws/doc/proposals/:pp/accept": async (ctx) => {
      const x = await env.domain(ctx);
      const rt = await ctx.runtime();
      const md = (ctx.body as { md?: unknown } | undefined)?.md;
      if (md !== undefined && typeof md !== "string") throw new MitoriError("E_INVALID_INPUT", "md must be a string", { params: { field: "md" } });
      const id = ctx.params.pp;
      pending(x, id);
      const block = await rt.write("doc.proposal.accept", () => x.doc.acceptProposal(id, md));
      const now = x.doc.block(block.id as BlockId);
      // a delete returns the block as it was; there is no view of a tombstone, so the old one stands in
      return blockView(x.view, now ?? block);
    },
    "POST /ws/:ws/doc/proposals/:pp/reject": async (ctx) => {
      const x = await env.domain(ctx);
      const rt = await ctx.runtime();
      const id = ctx.params.pp;
      pending(x, id);
      await rt.write("doc.proposal.reject", () => x.doc.rejectProposal(id));
      const ok: Ok = { ok: true };
      return ok;
    },
  };
}
