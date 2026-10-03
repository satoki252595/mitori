// Deterministic serialization of `doc.index.json` / `mitori.json` (gen §10.8) with a fragment memo (PT-11): every
// block / claim / section object is canonical-JSON'd once per change and the file is assembled by concatenation,
// byte-identical to `canonicalJson(index)` (tested).
import { canonicalJson, type DocIndex, FORMAT, type ReadingPath } from "@mitori/core";
import type { BlockRec, ClaimRec, DocState } from "./state.ts";

/** canonicalJson of `v`, re-indented for nesting at `depth` levels (no trailing newline). */
function frag(v: unknown, depth: number): string {
  const s = canonicalJson(v);
  const body = s.slice(0, -1);
  return depth === 0 ? body : body.replace(/\n/g, `\n${"  ".repeat(depth)}`);
}

const key = (k: string): string => JSON.stringify(k);

/** Round floats (rank, weight) to 4 decimals (§10.8). */
export const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export class IndexSerializer {
  private blockMemo = new Map<string, { tick: number; text: string }>();
  private claimMemo = new Map<string, { tick: number; text: string }>();
  private sortedBlocks: string[] = [];
  private sortedClaims: string[] = [];
  private blockSet = new Set<string>();
  private claimSet = new Set<string>();

  private sorted(ids: Iterable<string>, kind: "b" | "c"): string[] {
    const set = kind === "b" ? this.blockSet : this.claimSet;
    let list = kind === "b" ? this.sortedBlocks : this.sortedClaims;
    const now = new Set(ids);
    let changed = now.size !== set.size;
    if (!changed) for (const id of now) if (!set.has(id)) changed = true;
    if (changed) {
      list = [...now].sort();
      if (kind === "b") {
        this.sortedBlocks = list;
        this.blockSet = now;
      } else {
        this.sortedClaims = list;
        this.claimSet = now;
      }
    }
    return list;
  }

  private mapSection(
    name: string,
    ids: string[],
    get: (id: string) => { tick: number; obj: unknown },
    memo: Map<string, { tick: number; text: string }>,
  ): string {
    if (ids.length === 0) return `  ${key(name)}: {}`;
    const parts: string[] = [];
    for (const id of ids) {
      const { tick, obj } = get(id);
      let m = memo.get(id);
      if (!m || m.tick !== tick) {
        m = { tick, text: `    ${key(id)}: ${frag(obj, 2)}` };
        memo.set(id, m);
      }
      parts.push(m.text);
    }
    if (memo.size > ids.length * 2) for (const k of memo.keys()) if (!(name === "blocks" ? this.blockSet : this.claimSet).has(k)) memo.delete(k);
    return `  ${key(name)}: {\n${parts.join(",\n")}\n  }`;
  }

  private list(name: string, items: unknown[]): string {
    return `  ${key(name)}: ${items.length === 0 ? "[]" : frag(items, 1)}`;
  }

  /** The whole sidecar text. */
  serialize(st: DocState, readingPaths: ReadingPath[]): string {
    const blocks = this.mapSection(
      "blocks",
      this.sorted(st.blocks.keys(), "b"),
      (id) => {
        const r = st.blocks.get(id as never) as BlockRec;
        return { tick: r.metaTick, obj: r.meta };
      },
      this.blockMemo,
    );
    const claims = this.mapSection(
      "claims",
      this.sorted(st.claims.keys(), "c"),
      (id) => {
        const c = st.claims.get(id as never) as ClaimRec;
        return { tick: c.tick, obj: { ...c.claim, cites: c.fileCites } };
      },
      this.claimMemo,
    );
    const diagrams = [...st.diagrams.keys()].sort();
    const diagramsText =
      diagrams.length === 0
        ? `  "diagrams": {}`
        : `  "diagrams": {\n${diagrams.map((d) => `    ${key(d)}: ${frag(st.diagrams.get(d as never), 2)}`).join(",\n")}\n  }`;
    const modules = [...st.modules.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return [
      "{",
      `${blocks},`,
      `${claims},`,
      `${diagramsText},`,
      `${this.list("glossary", st.glossary)},`,
      `  "kind": "mitori/doc-index",`,
      `${this.list("modules", modules)},`,
      `${this.list("readingPaths", readingPaths)},`,
      `  "schemaVersion": ${FORMAT.docIndex},`,
      `${this.list("sections", st.orderedSections())}`,
      "}",
      "",
    ].join("\n");
  }
}

/** The same value as an object (for tests and `DocStore.index()`). */
export function indexObject(st: DocState, readingPaths: ReadingPath[]): DocIndex {
  const blocks: DocIndex["blocks"] = {};
  for (const [id, r] of st.blocks) blocks[id] = r.meta;
  const claims: DocIndex["claims"] = {};
  for (const [id, c] of st.claims) claims[id] = c.claim;
  const diagrams: DocIndex["diagrams"] = {};
  for (const [id, d] of st.diagrams) diagrams[id] = d;
  return {
    kind: "mitori/doc-index",
    schemaVersion: 1,
    sections: st.orderedSections(),
    blocks,
    claims,
    diagrams,
    glossary: st.glossary,
    readingPaths,
    modules: [...st.modules.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
