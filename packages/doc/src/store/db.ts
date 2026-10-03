// `doc_*` table access (history with text, proposals, tombstones, translations, decisions, ownership ledger, live cites).
import type {
  BlockHistoryEntry,
  BlockId,
  BlockKind,
  Cite,
  ClaimId,
  Decision,
  DocLang,
  DocProposal,
  Iso8601,
  MessageAuthor,
  ProposalId,
  SqlDb,
  Xxh3,
} from "@mitori/core";
import type { TranslationRecord } from "../contract.ts";

/** Extra data kept with a proposal (generated claims, accept bookkeeping for undo). */
export interface ProposalExtra {
  kind?: BlockKind;
  aspect?: string;
  /** Generated, already-stamped claims in marker order (file-form md carries their ranges). */
  claims?: { kind: string; cites: Cite[]; checks: unknown; verdict: string }[];
  /** Block revision written by the accept (undo source). */
  acceptedRev?: number;
  acceptedHash?: Xxh3;
  acceptedBlock?: BlockId;
}

interface ProposalRow {
  id: string;
  block: string | null;
  section: string;
  after: string | null;
  op: string;
  base_hash: string | null;
  md: string;
  source_kind: string;
  source_id: string;
  reason: string;
  state: string;
  conflict: number;
  external_links: number | null;
  created_at: string;
  extra: string | null;
}

export class DocDb {
  constructor(private readonly db: SqlDb) {}

  /* ---- history ---- */
  nextRev(block: BlockId): number {
    return (this.db.get<{ r: number | null }>("SELECT MAX(rev) AS r FROM doc_history WHERE block = ?", [block])?.r ?? 0) + 1;
  }

  addHistory(e: {
    block: BlockId;
    hash: Xxh3;
    md: string;
    kind: BlockKind;
    by: MessageAuthor;
    at: Iso8601;
    round?: number;
    source: BlockHistoryEntry["source"];
  }): number {
    const rev = this.nextRev(e.block);
    this.db.run("INSERT INTO doc_history (block, rev, hash, md, kind, by, at, round, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      e.block,
      rev,
      e.hash,
      e.md,
      e.kind,
      e.by,
      e.at,
      e.round ?? null,
      e.source,
    ]);
    return rev;
  }

  history(block: BlockId): BlockHistoryEntry[] {
    return this.db
      .all<{ rev: number; hash: string; by: string; at: string; round: number | null; source: string }>(
        "SELECT rev, hash, by, at, round, source FROM doc_history WHERE block = ? ORDER BY rev",
        [block],
      )
      .map((r) => ({
        block,
        rev: r.rev,
        hash: r.hash,
        by: r.by as MessageAuthor,
        at: r.at,
        ...(r.round === null ? {} : { round: r.round }),
        source: r.source as BlockHistoryEntry["source"],
      }));
  }

  textAt(block: BlockId, hash: Xxh3): string | null {
    return this.db.get<{ md: string }>("SELECT md FROM doc_history WHERE block = ? AND hash = ? ORDER BY rev DESC LIMIT 1", [block, hash])?.md ?? null;
  }

  revision(block: BlockId, rev: number): { md: string; hash: string; kind: string } | null {
    return this.db.get("SELECT md, hash, kind FROM doc_history WHERE block = ? AND rev = ?", [block, rev]);
  }

  hasHumanEdit(block: BlockId): boolean {
    return this.db.get("SELECT 1 AS x FROM doc_history WHERE block = ? AND source IN ('human_edit', 'import_external') LIMIT 1", [block]) !== null;
  }

  /* ---- proposals ---- */
  putProposal(p: DocProposal, extra: ProposalExtra = {}): void {
    this.db.run(
      `INSERT OR REPLACE INTO doc_proposals (id, block, section, after, op, base_hash, md, source_kind, source_id, reason, state, conflict, external_links, created_at, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id,
        p.block,
        p.section,
        p.after ?? null,
        p.op,
        p.baseHash,
        p.md,
        p.source.kind,
        p.source.id,
        p.reason,
        p.state,
        p.conflict ? 1 : 0,
        p.externalLinks ?? null,
        p.createdAt,
        JSON.stringify(extra),
      ],
    );
  }

  private toProposal(r: ProposalRow): DocProposal {
    return {
      id: r.id as ProposalId,
      block: r.block as BlockId | null,
      section: r.section as DocProposal["section"],
      ...(r.after === null ? {} : { after: r.after as BlockId }),
      op: r.op as DocProposal["op"],
      baseHash: r.base_hash,
      md: r.md,
      source: { kind: r.source_kind as DocProposal["source"]["kind"], id: r.source_id },
      reason: r.reason,
      state: r.state as DocProposal["state"],
      ...(r.conflict ? { conflict: true } : {}),
      ...(r.external_links === null ? {} : { externalLinks: r.external_links }),
      createdAt: r.created_at,
    };
  }

  proposal(id: ProposalId): { p: DocProposal; extra: ProposalExtra } | null {
    const r = this.db.get<ProposalRow>("SELECT * FROM doc_proposals WHERE id = ?", [id]);
    return r ? { p: this.toProposal(r), extra: JSON.parse(r.extra ?? "{}") as ProposalExtra } : null;
  }

  proposals(filter: { state?: DocProposal["state"]; block?: BlockId } = {}): DocProposal[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.state) {
      where.push("state = ?");
      args.push(filter.state);
    }
    if (filter.block) {
      where.push("block = ?");
      args.push(filter.block);
    }
    return this.db
      .all<ProposalRow>(`SELECT * FROM doc_proposals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, id`, args)
      .map((r) => this.toProposal(r));
  }

  setProposalState(id: ProposalId, state: DocProposal["state"], extra?: ProposalExtra, conflict?: boolean): void {
    if (extra) this.db.run("UPDATE doc_proposals SET state = ?, extra = ? WHERE id = ?", [state, JSON.stringify(extra), id]);
    else this.db.run("UPDATE doc_proposals SET state = ? WHERE id = ?", [state, id]);
    if (conflict !== undefined) this.db.run("UPDATE doc_proposals SET conflict = ? WHERE id = ?", [conflict ? 1 : 0, id]);
  }

  /* ---- tombstones ---- */
  tombstones(sinceMs: number): Set<string> {
    return new Set(this.db.all<{ id: string }>("SELECT id FROM doc_tombstones WHERE at >= ?", [sinceMs]).map((r) => r.id));
  }

  addTombstones(ids: readonly string[], at: number): void {
    for (const id of ids) this.db.run("INSERT OR REPLACE INTO doc_tombstones (id, at) VALUES (?, ?)", [id, at]);
  }

  removeTombstone(id: string): void {
    this.db.run("DELETE FROM doc_tombstones WHERE id = ?", [id]);
  }

  /* ---- translations ---- */
  translation(block: BlockId, lang: DocLang): TranslationRecord | null {
    const r = this.db.get<{ src_hash: string; md: string; prompt_ver: string; model: string }>(
      "SELECT src_hash, md, prompt_ver, model FROM doc_translations WHERE block = ? AND lang = ?",
      [block, lang],
    );
    return r
      ? { block, lang, srcHash: r.src_hash, md: r.md, promptVer: r.prompt_ver as TranslationRecord["promptVer"], model: r.model as TranslationRecord["model"] }
      : null;
  }

  putTranslation(t: TranslationRecord, at: Iso8601): void {
    this.db.run("INSERT OR REPLACE INTO doc_translations (block, lang, src_hash, md, prompt_ver, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      t.block,
      t.lang,
      t.srcHash,
      t.md,
      t.promptVer,
      t.model,
      at,
    ]);
  }

  /* ---- decisions ---- */
  decisions(): Decision[] {
    return this.db
      .all<{
        id: string;
        title: string;
        status: string;
        supersedes: string | null;
        thread: string | null;
        blocks: string;
        cites: string;
        file: string;
        decided_at: string;
      }>("SELECT * FROM doc_decisions ORDER BY decided_at, id")
      .map((r) => ({
        id: r.id as Decision["id"],
        title: r.title,
        status: r.status as Decision["status"],
        ...(r.supersedes ? { supersedes: r.supersedes as Decision["id"] } : {}),
        ...(r.thread ? { thread: r.thread as NonNullable<Decision["thread"]> } : {}),
        blocks: JSON.parse(r.blocks) as BlockId[],
        cites: JSON.parse(r.cites) as Cite[],
        file: r.file,
        decidedAt: r.decided_at,
      }));
  }

  putDecision(d: Decision): void {
    this.db.run(
      "INSERT OR REPLACE INTO doc_decisions (id, title, status, supersedes, thread, blocks, cites, file, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [d.id, d.title, d.status, d.supersedes ?? null, d.thread ?? null, JSON.stringify(d.blocks), JSON.stringify(d.cites), d.file, d.decidedAt],
    );
  }

  /* ---- ownership ledger ---- */
  ledger(rel: string): { digest: string; size: number; mtimeNs: string } | null {
    const r = this.db.get<{ digest: string; size: number; mtime_ns: string }>("SELECT digest, size, mtime_ns FROM doc_files WHERE rel = ?", [rel]);
    return r ? { digest: r.digest, size: r.size, mtimeNs: r.mtime_ns } : null;
  }

  setLedger(rel: string, digest: string, size: number, mtimeNs: bigint | string): void {
    this.db.run("INSERT OR REPLACE INTO doc_files (rel, digest, size, mtime_ns) VALUES (?, ?, ?, ?)", [rel, digest, size, String(mtimeNs)]);
  }

  /* ---- live cites ---- */
  liveCites(): Map<ClaimId, Cite[]> {
    return new Map(
      this.db.all<{ claim: string; cites: string }>("SELECT claim, cites FROM doc_cites").map((r) => [r.claim as ClaimId, JSON.parse(r.cites) as Cite[]]),
    );
  }

  putCites(claim: ClaimId, block: BlockId, cites: readonly Cite[]): void {
    this.db.run("INSERT OR REPLACE INTO doc_cites (claim, block, cites) VALUES (?, ?, ?)", [claim, block, JSON.stringify(cites)]);
  }

  dropCites(claims: readonly ClaimId[]): void {
    for (const c of claims) this.db.run("DELETE FROM doc_cites WHERE claim = ?", [c]);
  }
}
