import type { Block, BlockId, BlockKind, Cite, Claim, ClaimId, SectionId, SectionNode } from "@mitori/core";
import type { BundleBuilderDeps } from "../deps.ts";
import { toMarkers } from "../doc-md.ts";

// A tiny in-memory doc for WP-08a tests: sections with ordered blocks (md in file form, as `DocStore.block` gives it),
// their marker forms and the claims (cites) of those blocks.

export interface FakeBlock {
  id: BlockId;
  kind?: BlockKind;
  md: string;
  hash?: string;
  claims?: { id: ClaimId; cites: Cite[]; quote?: string }[];
}
export interface FakeSection {
  id: SectionId;
  title: string;
  blocks: FakeBlock[];
}

export function fakeDoc(sections: FakeSection[]): BundleBuilderDeps["doc"] & { all: Map<BlockId, Block> } {
  const all = new Map<BlockId, Block>();
  const nodes = new Map<SectionId, { node: SectionNode; blocks: Block[] }>();
  const claims = new Map<BlockId, Claim[]>();
  for (const s of sections) {
    const blocks: Block[] = s.blocks.map((b, ord) => ({
      id: b.id,
      section: s.id,
      file: "doc/06-modules.md",
      ord,
      kind: b.kind ?? "prose",
      depth: "L1",
      audience: ["dev"],
      lang: "ja",
      origin: "ai",
      status: "ready",
      freshness: "fresh",
      hash: b.hash ?? `${b.id.slice(2)}0000000000000000`.slice(0, 16),
      claims: (b.claims ?? []).map((c) => c.id),
      readingSec: 10,
      md: b.md,
    }));
    for (const b of blocks) all.set(b.id, b);
    for (const b of s.blocks) {
      const list: Claim[] = (b.claims ?? []).map((c) => ({
        id: c.id,
        block: b.id,
        kind: "behavior",
        quote: c.quote ?? "",
        cites: c.cites,
        verdict: "verified",
        checks: { l0: true, l1: "pass", l2: true, checkedAt: "2026-10-03T00:00:00.000Z" },
      }));
      claims.set(b.id, list);
    }
    nodes.set(s.id, {
      node: { id: s.id, title: s.title, file: "doc/06-modules.md", blocks: blocks.map((b) => b.id), children: [], state: "generated", readingSec: 10 },
      blocks,
    });
  }
  return {
    all,
    block: (id) => all.get(id) ?? null,
    markerForm: (id) => {
      const b = all.get(id);
      return b ? toMarkers(b.md) : null;
    },
    section: (id) => nodes.get(id) ?? null,
    claims: (block) => claims.get(block) ?? [],
  };
}
