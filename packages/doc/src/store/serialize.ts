// Deterministic serialization of `doc.index.json` / `mitori.json` (gen §10.8) with a fragment memo (PT-11): every
// block / claim / section object is canonical-JSON'd once per change, ids are grouped in buckets by their first two
// body characters (contiguous in sorted order), and only buckets with a changed member are re-joined. The output is
// byte-identical to `canonicalJson(index)` (tested).
import { canonicalJson, type DocIndex, FORMAT, type ReadingPath, type SectionNode } from "@mitori/core";
import type { BlockRec, ClaimRec, DocState } from "./state.ts";
import type { TrackedMap } from "./tracked.ts";

/** canonicalJson of `v`, re-indented for nesting at `depth` levels (no trailing newline). */
function frag(v: unknown, depth: number): string {
  const body = canonicalJson(v).slice(0, -1);
  return depth === 0 ? body : body.replace(/\n/g, `\n${"  ".repeat(depth)}`);
}

const key = (k: string): string => JSON.stringify(k);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Round floats (rank, weight) to 4 decimals (§10.8). */
export const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** One `"name": { "<id>": {...}, … }` member rendered from buckets. */
class MapRenderer<V> {
  private members = new Map<string, Set<string>>();
  private texts = new Map<string, string>();
  private order: string[] = [];
  private frags = new Map<string, { tick: number; text: string }>();

  constructor(
    private readonly name: string,
    private readonly prefix: number,
    private readonly map: TrackedMap<string, V>,
    private readonly view: (v: V) => { tick: number; obj: unknown },
  ) {}

  private bucketOf(id: string): string {
    return id.slice(this.prefix, this.prefix + 2);
  }

  private bucket(b: string): Set<string> {
    let s = this.members.get(b);
    if (!s) {
      s = new Set();
      this.members.set(b, s);
    }
    return s;
  }

  /** Re-join one bucket; true when its text changed. */
  private renderBucket(b: string): boolean {
    const ids = [...(this.members.get(b) ?? [])].sort(cmp);
    if (ids.length === 0) {
      this.members.delete(b);
      return this.texts.delete(b);
    }
    const parts = ids.map((id) => {
      const { tick, obj } = this.view(this.map.get(id) as V);
      let f = this.frags.get(id);
      if (!f || f.tick !== tick) {
        f = { tick, text: `    ${key(id)}: ${frag(obj, 2)}` };
        this.frags.set(id, f);
      }
      return f.text;
    });
    const text = parts.join(",\n");
    if (this.texts.get(b) === text) return false;
    this.texts.set(b, text);
    return true;
  }

  /** Append the member's pieces to `out` (joined once by the caller: one copy of an 18 MB sidecar, not two). */
  render(out: string[]): boolean {
    const dirty = this.map.drain();
    let touched: Set<string>;
    if (dirty === null) {
      this.members.clear();
      this.texts.clear();
      this.frags.clear();
      for (const id of this.map.keys()) this.bucket(this.bucketOf(id)).add(id);
      touched = new Set(this.members.keys());
    } else {
      touched = new Set();
      for (const id of dirty) {
        const b = this.bucketOf(id);
        const s = this.bucket(b);
        if (this.map.has(id)) s.add(id);
        else {
          s.delete(id);
          this.frags.delete(id);
        }
        touched.add(b);
      }
    }
    let changed = dirty === null;
    const buckets = this.texts.size;
    let added = false;
    for (const b of touched) {
      if (!this.texts.has(b)) added = true;
      if (this.renderBucket(b)) changed = true;
    }
    // the bucket order only changes when a bucket appears or disappears
    if (dirty === null || added || this.texts.size !== buckets) this.order = [...this.texts.keys()].sort(cmp);
    if (this.order.length === 0) {
      out.push(`  ${key(this.name)}: {}`);
      return changed;
    }
    out.push(`  ${key(this.name)}: {\n`);
    this.order.forEach((b, i) => {
      if (i > 0) out.push(",\n");
      out.push(this.texts.get(b) as string);
    });
    out.push("\n  }");
    return changed;
  }
}

export class IndexSerializer {
  private blocks: MapRenderer<BlockRec> | null = null;
  private claims: MapRenderer<ClaimRec> | null = null;
  private sectionMemo = new Map<string, { sig: string; text: string }>();
  private lastRest: string | null = null;

  private list(name: string, items: unknown[]): string {
    return `  ${key(name)}: ${items.length === 0 ? "[]" : frag(items, 1)}`;
  }

  /**
   * `"sections": [...]` with one memoized fragment per section; the signature is the section's model tick (bumped on
   * every block-list / derived-field change) plus the fields that are assigned directly.
   */
  private sections(st: DocState, list: SectionNode[]): string {
    if (list.length === 0) return `  "sections": []`;
    const parts = list.map((s) => {
      const sig = `${st.sectionTick.get(s.id) ?? -1}\u0000${s.title}\u0000${s.file}\u0000${s.state}\u0000${s.readingSec}\u0000${s.module ?? ""}\u0000${s.est ? `${s.est.inTokens}/${s.est.outTokens}` : ""}\u0000${s.children.join(",")}\u0000${s.blocks.length}`;
      let m = this.sectionMemo.get(s.id);
      if (!m || m.sig !== sig) {
        m = { sig, text: `    ${frag(s, 2)}` };
        this.sectionMemo.set(s.id, m);
      }
      return m.text;
    });
    return `  "sections": [\n${parts.join(",\n")}\n  ]`;
  }

  /** The whole sidecar text; `changed` is false when it equals the previous result (no 18 MB compare needed). */
  serialize(st: DocState, readingPaths: ReadingPath[]): { text: string; changed: boolean } {
    this.blocks ??= new MapRenderer<BlockRec>("blocks", 2, st.blocks as unknown as TrackedMap<string, BlockRec>, (r) => ({ tick: r.metaTick, obj: r.meta }));
    this.claims ??= new MapRenderer<ClaimRec>("claims", 3, st.claims as unknown as TrackedMap<string, ClaimRec>, (c) => ({
      tick: c.tick,
      obj: { ...c.claim, cites: c.fileCites },
    }));
    const diagrams = [...st.diagrams.keys()].sort(cmp);
    const diagramsText =
      diagrams.length === 0 ? `  "diagrams": {}` : `  "diagrams": {\n${diagrams.map((d) => `    ${key(d)}: ${frag(st.diagrams.get(d), 2)}`).join(",\n")}\n  }`;
    const modules = [...st.modules.values()].sort((a, b) => cmp(a.id, b.id));
    const out: string[] = ["{\n"];
    const changedBlocks = this.blocks.render(out);
    out.push(",\n");
    const changedClaims = this.claims.render(out);
    const rest = [
      ",\n",
      `${diagramsText},\n`,
      `${this.list("glossary", st.glossary)},\n`,
      `  "kind": "mitori/doc-index",\n`,
      `${this.list("modules", modules)},\n`,
      `${this.list("readingPaths", readingPaths)},\n`,
      `  "schemaVersion": ${FORMAT.docIndex},\n`,
      this.sections(st, st.orderedSections()),
      "\n}\n",
    ].join("");
    out.push(rest);
    const changed = changedBlocks || changedClaims || rest !== this.lastRest;
    this.lastRest = rest;
    return { text: out.join(""), changed };
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
    modules: [...st.modules.values()].sort((a, b) => cmp(a.id, b.id)),
  };
}
