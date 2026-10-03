// Text changes that arrive in FILE form (with cite links): accepted proposals (sentence-level 3-way rebase), undo,
// and the shared "apply file-form md to a block" step (links ⇄ claims, unchanged ranges keep their stamps).
import {
  type Block,
  type BlockId,
  type BlockKind,
  type Cite,
  type Claim,
  type ClaimChecks,
  type ClaimId,
  type ClaimKind,
  MitoriError,
  type ProposalId,
  type SectionNode,
  type Verdict,
} from "@mitori/core";
import { closeOpenFence } from "../codec/blocks.ts";
import { markerize } from "../codec/cite.ts";
import { merge3 } from "../codec/index.ts";
import { nfcProse, normalizeNewlines, parseDoc } from "../codec/parse.ts";
import { stripIdComments } from "../render/body.ts";
import { canonicalMarkers, matchGroups, pendingChecks, rawCite, sameRanges, verdictOf } from "./claims.ts";
import type { BlockRec, StoreCore } from "./core.ts";
import type { ProposalExtra } from "./db.ts";

/** A stamped claim known for a range set (generated proposals carry them). */
export interface KnownClaim {
  kind: string;
  cites: Cite[];
  checks: unknown;
  verdict: string;
}

/**
 * Normalize editor / proposal input: LF, NFC outside code, no outer blank lines, no block-ID comments (they delimit
 * blocks, so a pasted one would split the block on the next load), and a fence left open at the end is closed (it
 * would swallow the following blocks of the file).
 */
export function cleanMd(md: string, kind: BlockKind): string {
  const t = closeOpenFence(
    stripIdComments(normalizeNewlines(md).text)
      .replace(/^\s*\n/, "")
      .replace(/\s+$/, ""),
  );
  return kind === "code" || kind === "diagram" ? t : nfcProse(t);
}

/**
 * Replace a block's text with file-form md. Claims whose link ranges are unchanged keep id + stamp; ranges known
 * from `known` (generated proposals) reuse those stamps; the rest get raw cites and are queued in `toStamp`.
 * Returns the dropped claims.
 */
export function applyFileMd(core: StoreCore, rec: BlockRec, md: string, known: readonly KnownClaim[] | undefined, toStamp: ClaimId[]): Claim[] {
  const st = core.st;
  const code = rec.meta.kind === "code" || rec.meta.kind === "diagram";
  const text = cleanMd(md, rec.meta.kind);
  const { md: m0, links } = code ? { md: text, links: [] } : markerize(text, core.lang(), core.ctxOf(rec.meta.file));
  const marker = canonicalMarkers(m0).md;
  const old = st.claimsOf(rec).map((c) => c.claim);
  const { matched, dropped } = matchGroups(links, old);
  const ids: ClaimId[] = links.map((g, i) => {
    const m = matched[i];
    const cr = m ? st.claims.get(m.id) : undefined;
    if (cr && sameRanges(g, cr.claim.cites)) return cr.claim.id;
    const k = known?.[i];
    const stamped = k && sameRanges(g, k.cites);
    const cites = stamped ? k.cites : g.cites.map(rawCite);
    const checks = stamped ? (k.checks as ClaimChecks) : pendingChecks(core.now());
    if (cr) {
      core.setLiveCites(cr, cites);
      cr.fileCites = cites;
      cr.claim.checks = checks;
      cr.claim.verdict = verdictOf(checks, cites, rec.meta.lock);
      st.touchClaim(cr);
      if (!stamped && cites.length > 0) toStamp.push(cr.claim.id);
      return cr.claim.id;
    }
    const kind = (stamped ? k.kind : "fact") as ClaimKind;
    const nc = core.addClaim(rec.meta.id, { kind, quote: "", cites, verdict: verdictOf(checks, cites, rec.meta.lock), checks });
    core.db.putCites(nc.claim.id, rec.meta.id, cites);
    if (!stamped && cites.length > 0) toStamp.push(nc.claim.id);
    return nc.claim.id;
  });
  for (const d of dropped) st.claims.delete(d.id);
  core.db.dropCites(dropped.map((d) => d.id));
  rec.meta.claims = ids;
  core.setText(rec, marker);
  core.refreshQuotes(rec);
  return dropped;
}

/** Make sure the block's current text is in history (the undo / 3-way base of what comes next). */
export function snapshot(core: StoreCore, rec: BlockRec): void {
  const h = core.db.history(rec.meta.id);
  if (h[h.length - 1]?.hash === rec.meta.hash) return;
  core.history(rec, "system", rec.meta.origin === "human" ? "human_edit" : rec.meta.origin === "ai" ? "generate" : "regen");
}

function supersedeOthers(core: StoreCore, block: BlockId, keep: ProposalId): void {
  for (const p of core.db.proposals({ state: "pending", block })) {
    if (p.id === keep) continue;
    core.db.setProposalState(p.id, "superseded");
    core.deps.events.emit({ type: "doc.proposal.removed", id: p.id });
  }
}

/** Kind of an inserted proposal's md (`extra.kind`, else the shape of the text). */
function kindOfInsert(core: StoreCore, md: string, extra: ProposalExtra): BlockKind {
  if (extra.kind) return extra.kind;
  const p = parseDoc(md, "proposal.md", core.ctxOf("doc/00-tldr.md"));
  return p.blocks[0]?.kindHint ?? "prose";
}

/** Accept a proposal (optionally with edited text). Returns the block (its pre-delete state for `delete`). */
export function acceptProposal(core: StoreCore, id: ProposalId, edited: string | undefined, restamp: (ids: ClaimId[]) => void): Block {
  const st = core.st;
  const row = core.db.proposal(id);
  if (!row) throw new MitoriError("E_NOT_FOUND", `no proposal ${id}`);
  if (row.p.state !== "pending") throw new MitoriError("E_PRECONDITION", `proposal ${id} is ${row.p.state}`);
  let p = row.p;
  const extra: ProposalExtra = { ...row.extra };
  const toStamp: ClaimId[] = [];
  const known = extra.claims as KnownClaim[] | undefined;
  if (p.op === "insert") {
    const section = st.sections.get(p.section) as SectionNode | undefined;
    if (!section) throw new MitoriError("E_NOT_FOUND", `no section ${p.section}`);
    const md = edited ?? p.md;
    const kind = kindOfInsert(core, md, extra);
    const bid = core.newBlockId();
    const rec = core.makeBlock({
      id: bid,
      section: p.section,
      kind,
      marker: "",
      origin: "ai",
      ...(extra.aspect ? { aspect: extra.aspect as Block["aspect"] & string } : {}),
    });
    const after = p.after ? section.blocks.indexOf(p.after) : -1;
    st.insertBlock(rec, p.section, after >= 0 ? after + 1 : core.insertIndex(p.section, core.rankOf(rec.meta) ?? 149));
    applyFileMd(core, rec, md, known, toStamp);
    const rev = core.history(rec, "human", "accept_proposal");
    core.db.setProposalState(p.id, "accepted", { ...extra, acceptedRev: rev, acceptedHash: rec.meta.hash, acceptedBlock: bid });
    restamp(toStamp);
    return st.toBlock(rec);
  }
  const rec = p.block ? st.blocks.get(p.block) : undefined;
  if (!rec) throw new MitoriError("E_NOT_FOUND", `proposal ${id} targets a missing block`);
  if (p.op === "delete") {
    if (p.baseHash && p.baseHash !== rec.meta.hash) {
      core.db.setProposalState(p.id, "pending", undefined, true);
      throw new MitoriError("E_DOC_BASE_MISMATCH", "the block changed since the delete was proposed");
    }
    snapshot(core, rec);
    const before = st.toBlock(rec);
    const rev = core.db.history(rec.meta.id).at(-1)?.rev ?? 0;
    supersedeOthers(core, rec.meta.id, p.id);
    core.db.setProposalState(p.id, "accepted", { ...extra, acceptedRev: rev, acceptedHash: rec.meta.hash, acceptedBlock: rec.meta.id });
    core.tombstone([rec.meta.id]);
    return before;
  }
  let md = edited ?? p.md;
  if (p.baseHash !== rec.meta.hash) {
    const base = p.baseHash ? core.db.textAt(rec.meta.id, p.baseHash) : null;
    const merged = base === null ? ({ ok: false, conflicts: 1 } as const) : merge3(base, st.fileMd(rec, true), md);
    if (!merged.ok) {
      core.db.setProposalState(p.id, "pending", undefined, true);
      throw new MitoriError("E_DOC_BASE_MISMATCH", "the block changed since the proposal; the sentence-level merge overlaps", {
        params: { conflicts: merged.conflicts },
      });
    }
    // the rebased text is a new proposal (the old one is superseded) and is accepted right away (§10.6-4)
    md = merged.md;
    const nid = core.deps.ids.next("proposal") as ProposalId;
    const next = { ...p, id: nid, baseHash: rec.meta.hash, md, createdAt: core.now() };
    core.db.putProposal(next, extra);
    core.db.setProposalState(p.id, "superseded");
    core.deps.events.emit({ type: "doc.proposal.removed", id: p.id });
    p = next;
  }
  snapshot(core, rec);
  // a proposal may change the kind too (a static facts list that became a diagram, a list regenerated as a table)
  if (extra.kind && extra.kind !== rec.meta.kind) rec.meta.kind = extra.kind;
  applyFileMd(core, rec, md, known, toStamp);
  const rev = core.history(rec, "human", "accept_proposal");
  supersedeOthers(core, rec.meta.id, p.id);
  core.db.setProposalState(p.id, "accepted", { ...extra, acceptedRev: rev, acceptedHash: rec.meta.hash, acceptedBlock: rec.meta.id });
  restamp(toStamp);
  return st.toBlock(rec);
}

/** Undo accepted proposals: blocks still at the post-accept hash revert; others are reported as diverged. */
export function undoAccept(core: StoreCore, ids: readonly ProposalId[], restamp: (ids: ClaimId[]) => void): { reverted: BlockId[]; diverged: BlockId[] } {
  const st = core.st;
  const reverted: BlockId[] = [];
  const diverged: BlockId[] = [];
  const toStamp: ClaimId[] = [];
  for (const pid of ids) {
    const row = core.db.proposal(pid);
    if (row?.p.state !== "accepted" || row.extra.acceptedBlock === undefined || row.extra.acceptedRev === undefined) continue;
    const { acceptedBlock: bid, acceptedRev: rev, acceptedHash } = row.extra;
    const rec = st.blocks.get(bid);
    if (row.p.op === "delete") {
      const prev = core.db.revision(bid, rev);
      const section = row.p.section;
      if (rec || !prev || !st.sections.has(section)) {
        diverged.push(bid);
        continue;
      }
      core.db.removeTombstone(bid);
      core.tombs.delete(bid);
      const back = core.makeBlock({ id: bid, section, kind: prev.kind as BlockKind, marker: "", origin: "ai" });
      st.insertBlock(back, section, core.insertIndex(section, core.rankOf(back.meta) ?? 149));
      applyFileMd(core, back, prev.md, undefined, toStamp);
      core.history(back, "human", "undo");
      reverted.push(bid);
    } else if (!rec || rec.meta.hash !== acceptedHash) diverged.push(bid);
    else if (row.p.op === "insert") reverted.push(...core.tombstone([bid]));
    else {
      const prev = core.db.revision(bid, rev - 1);
      if (!prev) {
        diverged.push(bid);
        continue;
      }
      rec.meta.kind = prev.kind as BlockKind;
      applyFileMd(core, rec, prev.md, undefined, toStamp);
      core.history(rec, "human", "undo");
      reverted.push(bid);
    }
    const { acceptedRev: _r, acceptedHash: _h, acceptedBlock: _b, ...rest } = row.extra;
    core.db.setProposalState(pid, "accepted", rest);
  }
  restamp(toStamp);
  return { reverted, diverged };
}

export type { Verdict };
