/**
 * In-memory `DocStore` covering what gen reads and writes (WP-04 owns the real one). Block md is kept in
 * MARKER form; the semantic hash is xxh3(md). Locked blocks and `mode: "propose"` produce proposals; updates
 * with an unchanged hash are no-ops (AC-28); deletes tombstone.
 */
import {
  type Block,
  type BlockId,
  type Claim,
  type ClaimId,
  type DocIndex,
  type DocManifest,
  type DocModuleEntry,
  type DocProposal,
  type GlossaryEntry,
  type Hasher,
  MitoriError,
  type ProposalId,
  type SectionId,
  type SectionNode,
  unsupported,
} from "@mitori/core";
import type { ApplyOptions, ApplyResult, DocStore, GeneratedBlock, GenIdSource, ModuleLabel, NewBlockRef } from "@mitori/doc";
import { plainText } from "../line/mdscan.ts";
import type { FakeRepo } from "./repo.ts";

/** One recorded mutation. */
export interface DocOp {
  /** Operation. */
  op: "apply" | "labels" | "flow" | "glossary" | "tombstone";
  /** Sequence number. */
  seq: number;
  /** Payload. */
  detail: unknown;
}

/** Fake handle. */
export interface FakeDocStore extends DocStore {
  /** Mutations in order. */
  ops: DocOp[];
  /** Tombstoned ids. */
  tombstones: Set<BlockId>;
  /** Byte-stable dump of the doc state (AC-28 "doc bytes unchanged"). */
  dump(): string;
  /** Lock a block as a human would. */
  lock(id: BlockId, lock: "human-edited" | "human-verified"): void;
  /** Set a block's freshness. */
  markStale(id: BlockId): void;
}

/** Factory. `repo` seeds `DocIndex.modules` and one static heading per module section. */
export function createFakeDocStore(deps: { hasher: Hasher; ids: GenIdSource; repo?: FakeRepo; lang?: "ja" | "en" }): FakeDocStore {
  const lang = deps.lang ?? "ja";
  const blocks = new Map<BlockId, Block>();
  const claims = new Map<ClaimId, Claim>();
  const sections = new Map<SectionId, SectionNode>();
  const proposals: DocProposal[] = [];
  const tombstones = new Set<BlockId>();
  let glossary: GlossaryEntry[] = [];
  const ops: DocOp[] = [];
  let seq = 0;
  const modules: DocModuleEntry[] = (deps.repo?.modules ?? []).map((m) => ({
    id: m.id,
    section: `s6/${m.slug}` as SectionId,
    ifaceDigest: "0",
    slug: m.slug,
    name: m.name,
    reps: m.paths,
  }));
  const ensureSection = (id: SectionId): SectionNode => {
    let s = sections.get(id);
    if (!s) {
      s = { id, title: id, file: `doc/${id.replace("/", "-")}.md`, blocks: [], children: [], state: "pending", readingSec: 0 };
      sections.set(id, s);
    }
    return s;
  };
  for (const id of ["s0", "s1", "s2", "s3", "s12"] as SectionId[]) ensureSection(id);
  const addStatic = (section: SectionId, slot: string) => {
    const id = `b_${deps.hasher
      .xxh3(slot)
      .slice(0, 8)
      .replace(/[ilou]/g, "0")}` as BlockId;
    blocks.set(id, {
      id,
      section,
      file: ensureSection(section).file,
      ord: 0,
      kind: "heading",
      depth: "L1",
      audience: ["dev"],
      lang,
      origin: "static",
      status: "ready",
      freshness: "fresh",
      hash: deps.hasher.xxh3(slot),
      claims: [],
      readingSec: 1,
      slot,
      md: section,
    });
    ensureSection(section).blocks.push(id);
  };
  for (const m of modules) addStatic(m.section, `m:${m.id}:h`);

  const hashOf = (b: { md: string; claims: readonly { n: number; kind: string; cites: readonly { path: string; start: number; end: number }[] }[] }) =>
    deps.hasher.xxh3(`${b.md}\n${JSON.stringify(b.claims.map((c) => [c.n, c.kind, c.cites.map((x) => [x.path, x.start, x.end])]))}`);

  const propose = (p: Omit<DocProposal, "id" | "state" | "createdAt">): DocProposal => {
    const full: DocProposal = { ...p, id: deps.ids.next("proposal") as ProposalId, state: "pending", createdAt: "2026-10-03T00:00:00.000Z" };
    proposals.push(full);
    return full;
  };

  const writeClaims = (blockId: BlockId, gb: GeneratedBlock): ClaimId[] =>
    gb.claims.map((c) => {
      const id = (c.reuse ?? deps.ids.next("claim")) as ClaimId;
      claims.set(id, { id, block: blockId, kind: c.kind, quote: c.quote, cites: c.cites, verdict: c.verdict, checks: c.checks });
      return id;
    });

  const store: FakeDocStore = {
    ops,
    tombstones,
    dump() {
      const view = {
        blocks: [...blocks.values()]
          .filter((b) => b.origin !== "static")
          .map((b) => ({ id: b.id, section: b.section, aspect: b.aspect, kind: b.kind, md: b.md, lock: b.lock, claims: b.claims.map((c) => claims.get(c)) }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
        sections: [...sections.values()].map((s) => ({ id: s.id, title: s.title, blocks: s.blocks })).sort((a, b) => (a.id < b.id ? -1 : 1)),
        modules,
        glossary,
        proposals: proposals.length,
      };
      return JSON.stringify(view);
    },
    lock(id, lock) {
      const b = blocks.get(id);
      if (b) b.lock = lock;
    },
    markStale(id) {
      const b = blocks.get(id);
      if (b) b.freshness = "stale";
    },
    load: async () => ({ manifest: null, externallyEdited: [], assignedIds: [], orphaned: [], problems: [] }),
    manifest: () => null,
    index: (): DocIndex => ({
      kind: "mitori/doc-index",
      schemaVersion: 1,
      sections: [...sections.values()],
      blocks: Object.fromEntries(blocks),
      claims: Object.fromEntries(claims),
      diagrams: {},
      glossary,
      readingPaths: [],
      modules,
    }),
    sections: () => [...sections.values()],
    section: (id) => {
      const node = sections.get(id);
      return node ? { node, blocks: node.blocks.map((b) => blocks.get(b)).filter((b): b is Block => b !== undefined) } : null;
    },
    block: (id) => blocks.get(id) ?? null,
    markerForm: (id) => blocks.get(id)?.md ?? null,
    blockText: (id) => {
      const b = blocks.get(id);
      return b ? plainText(b.md) : null;
    },
    claims: (block) => (blocks.get(block)?.claims ?? []).map((c) => claims.get(c)).filter((c): c is Claim => c !== undefined),
    blocksCiting: () => [],
    applyStatic: (input) => unsupported("fakeDoc.applyStatic", input),
    applyGenerated(gbs: GeneratedBlock[], opts: ApplyOptions): ApplyResult {
      const res: ApplyResult = { written: [], deleted: [], proposals: [], unchanged: [], idMap: {} };
      ops.push({ op: "apply", seq: seq++, detail: { blocks: gbs.map((b) => b.id ?? b.ref), deletes: opts.deletes, mode: opts.mode } });
      for (const gb of gbs) {
        const hash = hashOf(gb);
        if (gb.id === null) {
          if (opts.mode === "propose") {
            const after = typeof gb.after === "string" && gb.after.startsWith("b_") ? (gb.after as BlockId) : null;
            res.proposals.push(
              propose({ block: null, section: gb.section, after, op: "insert", baseHash: null, md: gb.md, source: opts.source, reason: opts.reason }).id,
            );
            continue;
          }
          const id = deps.ids.next("block") as BlockId;
          const node = ensureSection(gb.section);
          const blk: Block = {
            id,
            section: gb.section,
            file: node.file,
            ord: node.blocks.length,
            kind: gb.kind,
            depth: gb.depth,
            audience: gb.audience,
            lang: gb.lang,
            origin: "ai",
            status: "ready",
            freshness: "fresh",
            hash,
            claims: [],
            readingSec: 1,
            gen: gb.gen,
            md: gb.md,
          };
          if (gb.aspect) blk.aspect = gb.aspect;
          blocks.set(id, blk);
          blk.claims = writeClaims(id, gb);
          const afterId = typeof gb.after === "string" ? (gb.after.startsWith("new:") ? res.idMap[gb.after as NewBlockRef] : (gb.after as BlockId)) : undefined;
          const at = afterId ? node.blocks.indexOf(afterId) : -1;
          if (at >= 0) node.blocks.splice(at + 1, 0, id);
          else node.blocks.push(id);
          node.state = "generated";
          if (gb.ref) res.idMap[gb.ref] = id;
          res.written.push(id);
          continue;
        }
        const cur = blocks.get(gb.id);
        if (!cur) throw new MitoriError("E_NOT_FOUND", `block ${gb.id} not found`);
        if (cur.hash === hash) {
          res.unchanged.push(gb.id);
          continue;
        }
        if (cur.lock || opts.mode === "propose") {
          res.proposals.push(
            propose({ block: gb.id, section: cur.section, op: "update", baseHash: cur.hash, md: gb.md, source: opts.source, reason: opts.reason }).id,
          );
          continue;
        }
        for (const c of cur.claims) if (!gb.claims.some((x) => x.reuse === c)) claims.delete(c);
        cur.md = gb.md;
        cur.hash = hash;
        cur.kind = gb.kind;
        cur.depth = gb.depth;
        cur.audience = gb.audience;
        cur.gen = gb.gen;
        cur.claims = writeClaims(cur.id, gb);
        res.written.push(cur.id);
      }
      for (const id of opts.deletes) {
        const cur = blocks.get(id);
        if (!cur) continue;
        if (cur.lock || opts.mode === "propose") {
          res.proposals.push(
            propose({ block: id, section: cur.section, op: "delete", baseHash: cur.hash, md: "", source: opts.source, reason: opts.reason }).id,
          );
          continue;
        }
        blocks.delete(id);
        const node = sections.get(cur.section);
        if (node) node.blocks = node.blocks.filter((b) => b !== id);
        tombstones.add(id);
        res.deleted.push(id);
      }
      return res;
    },
    setModuleLabels(labels: ModuleLabel[]) {
      ops.push({ op: "labels", seq: seq++, detail: labels });
      for (const l of labels) {
        const e = modules.find((m) => m.id === l.module);
        if (!e) continue;
        e.name = l.name;
        if (l.summary !== undefined) e.summary = l.summary;
      }
    },
    upsertFlowSection(key, title, order) {
      ops.push({ op: "flow", seq: seq++, detail: { key, title, order } });
      const node = ensureSection(`s3/${key}`);
      node.title = title;
      const parent = ensureSection("s3");
      if (!parent.children.includes(node.id)) parent.children.splice(order, 0, node.id);
      return node;
    },
    removeSection: (id) => unsupported("fakeDoc.removeSection", id),
    setGlossary(entries) {
      ops.push({ op: "glossary", seq: seq++, detail: entries });
      glossary = entries.map((e) => ({ ...e, id: `gl_${deps.hasher.xxh3(e.term).slice(0, 8)}` as GlossaryEntry["id"], usedIn: [] }));
    },
    editBlock: (id) => unsupported("fakeDoc.editBlock", id),
    setVerified: (id) => unsupported("fakeDoc.setVerified", id),
    setFreshness(ids, freshness) {
      for (const id of ids) {
        const b = blocks.get(id);
        if (b) b.freshness = freshness;
      }
    },
    setClaimChecks: () => undefined,
    propose,
    proposals: (filter) => proposals.filter((p) => (!filter?.state || p.state === filter.state) && (!filter?.block || p.block === filter.block)),
    acceptProposal: (id) => unsupported("fakeDoc.acceptProposal", id),
    rejectProposal: (id) => unsupported("fakeDoc.rejectProposal", id),
    undoAccept: (ids) => unsupported("fakeDoc.undoAccept", ids),
    history: () => [],
    textAt: () => null,
    writeDecision: (d) => unsupported("fakeDoc.writeDecision", d),
    decisions: () => [],
    translation: () => null,
    putTranslation: () => undefined,
    tombstone(ids) {
      ops.push({ op: "tombstone", seq: seq++, detail: ids });
      for (const id of ids) {
        tombstones.add(id);
        const cur = blocks.get(id);
        if (!cur) continue;
        blocks.delete(id);
        const node = sections.get(cur.section);
        if (node) node.blocks = node.blocks.filter((b) => b !== id);
      }
    },
    flush: async () => [],
    ensureManifest: (): DocManifest => unsupported("fakeDoc.ensureManifest"),
  };
  return store;
}
