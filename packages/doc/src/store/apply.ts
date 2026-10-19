// Writes that come from the index (applyStatic, zero tokens) and from gen (applyGenerated, id-referenced). Locked
// blocks never change here: their updates and deletes become DocProposals (D12, §6.7).
import {
  type BlockAspect,
  type BlockId,
  base32,
  type Cite,
  type Claim,
  type ClaimId,
  canonicalJson,
  type DiagramId,
  type DiagramIR,
  DOC_TEMPLATE,
  type DocManifest,
  type DocModuleEntry,
  type DocProposal,
  type MessageAuthor,
  MitoriError,
  type ModelId,
  type ModuleId,
  type PromptVersion,
  type ProposalId,
  type SectionId,
  type SectionNode,
  staticBlockId,
  type TopSectionId,
} from "@mitori/core";
import { closeOpenFence } from "../codec/blocks.ts";
import { literalGroups, markerPositions, unmarkerize } from "../codec/cite.ts";
import { type ApplyOptions, type ApplyResult, ASPECT_HEADINGS, type GeneratedBlock, type NewBlockRef, type StaticDocInput } from "../contract.ts";
import { toMermaidText } from "../layout/mermaid.ts";
import { canonicalMarkers, pendingChecks, rawCite, verdictOf } from "./claims.ts";
import type { BlockRec, StoreCore } from "./core.ts";
import { snapshot } from "./edit.ts";
import { L } from "./i18n.ts";
import { safeSlug, topOf, uniqueSlug } from "./paths.ts";
import { round4 } from "./serialize.ts";
import {
  buildStatic,
  decisionsTable,
  type Estimates,
  estText,
  glossaryTable,
  metaList,
  modulePages,
  placeholderSpec,
  RANK,
  type StaticSpec,
  sectionHeading,
  sourcesTable,
} from "./static.ts";

/** mitori version stamped into a new manifest (CR-PENDING(WP-04): the composition root should pass it). */
const MITORI_VERSION = "0.0.0";

const emptyResult = (): ApplyResult => ({ written: [], deleted: [], proposals: [], unchanged: [], idMap: {} });

/** A diagram IR as persisted: with its id, node weights rounded to 4 decimals (§10.8). */
function irOf(d: Omit<DiagramIR, "id">, id: DiagramId): DiagramIR {
  return { ...d, id, nodes: d.nodes.map((n) => (n.weight === undefined ? n : { ...n, weight: round4(n.weight) })) };
}

/** Mint docId + skeleton manifest if absent [CONS-11]. */
export function ensureManifest(core: StoreCore): DocManifest {
  const st = core.st;
  if (st.manifest) return st.manifest;
  const { ws, hasher, clock, ids } = core.deps;
  // CR-PENDING(WP-04): GenIdSource has no "doc" kind; derive 60 bits from the workspace, time and a fresh random id
  const seed = hasher.sha256(`${ws.key}\u0000${clock.iso()}\u0000${ids.next("block")}`);
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = Number.parseInt(seed.slice(i * 2, i * 2 + 2), 16);
  const docId = ws.docId ?? (`doc_${base32(bytes).slice(0, 12)}` as const);
  st.manifest = {
    kind: "mitori/doc-manifest",
    schemaVersion: 1,
    docId,
    title: ws.name,
    primaryLang: "ja",
    snapshot: { commit: null, indexDigest: "" },
    generator: { mitoriVersion: MITORI_VERSION, prompts: {}, extractors: {} },
    models: [],
    effort: null,
    coverage: { filesTotal: 0, filesIncluded: 0, filesExcluded: {}, locIncluded: 0, modulesTotal: 0, modulesGenerated: 0, claimsTotal: 0, claimsVerified: 0 },
    usageTotals: { calls: 0, in: 0, cacheWrite: 0, cacheRead: 0, out: 0, apiUsd: 0 },
    generatedAt: null,
  };
  st.manifestTick = st.tick();
  for (const s of st.sections.values()) s.title = titleOf(s.id, st.manifest.primaryLang) ?? s.title;
  return st.manifest;
}

function titleOf(id: SectionId, lang: "ja" | "en"): string | null {
  const t = DOC_TEMPLATE.find((x) => x.id === id);
  return t ? (lang === "ja" ? t.titleJa : t.titleEn) : null;
}

/** Content blocks of a section (anything but headings, static facts and placeholders). */
function hasContent(core: StoreCore, section: SectionId): boolean {
  const s = core.st.sections.get(section);
  return (
    !!s &&
    s.blocks.some((id) => {
      const m = core.st.blocks.get(id)?.meta;
      return !!m && m.origin !== "static" && m.kind !== "heading" && m.kind !== "placeholder";
    })
  );
}

const STATIC_ONLY = new Set<TopSectionId>(["s4", "s5", "s6", "s8", "appendix"]);

/** Placeholders for sections whose AI content is still missing (the TOC never shows an empty section). */
function placeholders(core: StoreCore, est: Estimates, schemaFacts: number, only?: ReadonlySet<SectionId>): StaticSpec[] {
  const l = L[core.lang()];
  const out: StaticSpec[] = [];
  const estOf = (s: SectionId) => est[s] ?? core.st.sections.get(s)?.est;
  for (const t of DOC_TEMPLATE) {
    if ((only && !only.has(t.id)) || STATIC_ONLY.has(t.id) || hasContent(core, t.id)) continue;
    if (t.id === "s7" && schemaFacts === 0) continue;
    if (t.id === "s12" && core.st.glossary.length > 0) continue;
    out.push(placeholderSpec(t.id, `${t.id}:ph`, l.placeholder(estText(estOf(t.id))), RANK.ph));
  }
  for (const m of core.st.modules.values()) {
    if ((only && !only.has(m.section)) || hasContent(core, m.section)) continue;
    out.push(placeholderSpec(m.section, `m:${m.id}:ph`, l.lazyModule(estText(estOf(m.section))), RANK.modulePh));
  }
  return out;
}

/** Placeholder slot of a section (`<section>:ph`, `m:<module>:ph`). */
function placeholderSlot(core: StoreCore, section: SectionId): string {
  const mod = core.st.sections.get(section)?.module;
  return mod ? `m:${mod}:ph` : `${section}:ph`;
}

/** Store-derived static blocks (decisions, glossary, sources, generation meta). */
function derived(core: StoreCore): StaticSpec[] {
  const l = L[core.lang()];
  const st = core.st;
  const out: StaticSpec[] = [
    {
      slot: "s10:decisions",
      section: "s10",
      kind: "facts",
      md: decisionsTable(core.db.decisions(), l),
      depth: "L2",
      audience: ["reviewer", "dev", "pm"],
      rank: RANK.post,
    },
  ];
  if (st.glossary.length > 0)
    out.push({
      slot: "s12:table",
      section: "s12",
      kind: "table",
      md: glossaryTable(st.glossary, l),
      depth: "L1",
      audience: ["newcomer", "dev"],
      rank: RANK.post,
    });
  out.push(sourcesSpec(core), ...metaSpec(core));
  return out;
}

/** Appendix generation meta `ap:meta` (from the manifest). */
function metaSpec(core: StoreCore): StaticSpec[] {
  const m = core.st.manifest;
  if (!m) return [];
  return [
    { slot: "ap:meta", section: "appendix", kind: "facts", md: metaList(m, L[core.lang()]), depth: "L3", audience: ["reviewer", "dev"], rank: RANK.post2 },
  ];
}

/**
 * Redraw `ap:meta` from the current manifest. `stampRun` calls it: without this the appendix kept the
 * pre-run manifest (commit なし · usage 0 · 未生成) after the run stamped the real values [CR wp30-4].
 */
export function refreshMeta(core: StoreCore): void {
  if (!core.st.manifest) return;
  const res = emptyResult();
  for (const spec of metaSpec(core)) upsertStatic(core, spec, res);
}

/**
 * Manifest `models` / `generator.prompts` = what produced the current AI blocks (their `gen` stamps). The rest of the
 * run stamp (effort, usage, snapshot, generatedAt) is the generation run's — CR-PENDING(WP-04): no DocStore method yet.
 * With `written`, the whole doc is scanned only when one of those blocks brings a stamp the manifest lacks (a 10k-block
 * scan per apply costs the flush budget in GC); applyStatic rescans and drops stamps no block carries any more.
 */
function stampGenerator(core: StoreCore, written?: readonly BlockId[]): void {
  const m = core.st.manifest;
  if (!m) return;
  const promptId = (v: string) => v.slice(0, v.lastIndexOf("@"));
  if (
    written &&
    !written.some((id) => {
      const g = core.st.blocks.get(id)?.meta.gen;
      return g !== undefined && (!m.models.includes(g.model) || m.generator.prompts[promptId(g.promptVer)] !== g.promptVer);
    })
  )
    return;
  const models = new Set<string>();
  const prompts: Record<string, PromptVersion> = {};
  const ver = (v: string) => Number(v.slice(v.lastIndexOf("@") + 1));
  for (const rec of core.st.blocks.values()) {
    const g = rec.meta.gen;
    if (!g || rec.meta.origin !== "ai") continue;
    models.add(g.model);
    const id = promptId(g.promptVer);
    const cur = prompts[id];
    if (!cur || ver(g.promptVer) > ver(cur)) prompts[id] = g.promptVer;
  }
  const nextModels = [...models].sort() as ModelId[];
  const nextPrompts = Object.fromEntries(Object.entries(prompts).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  if (canonicalJson(nextModels) === canonicalJson(m.models) && canonicalJson(nextPrompts) === canonicalJson(m.generator.prompts)) return;
  m.models = nextModels;
  m.generator = { ...m.generator, prompts: nextPrompts };
  core.st.manifestTick = core.st.tick();
}

/** Appendix source index `ap:sources` (cited file → number of citing blocks); changes whenever claims do. */
function sourcesSpec(core: StoreCore): StaticSpec {
  // per path: number of distinct citing blocks (`last` dedupes the claims of one block without a Set per path)
  const sources = new Map<string, { n: number; last: BlockId | null }>();
  for (const rec of core.st.blocks.values())
    for (const cid of rec.meta.claims)
      for (const ct of core.st.claims.get(cid)?.claim.cites ?? []) {
        const e = sources.get(ct.path);
        if (!e) sources.set(ct.path, { n: 1, last: rec.meta.id });
        else if (e.last !== rec.meta.id) {
          e.n++;
          e.last = rec.meta.id;
        }
      }
  return {
    slot: "ap:sources",
    section: "appendix",
    kind: "facts",
    md: sourcesTable(new Map([...sources].map(([p, e]) => [p, e.n])), L[core.lang()]),
    depth: "L3",
    audience: ["reviewer", "dev"],
    rank: RANK.post,
  };
}

/** Sorted distinct paths a block's claims cite (source-index change detection). */
function citedPaths(core: StoreCore, rec: BlockRec): string {
  const paths = new Set<string>();
  for (const id of rec.meta.claims) for (const c of core.st.claims.get(id)?.claim.cites ?? []) paths.add(c.path);
  return [...paths].sort().join("\n");
}

/** The sections stored in a module page's file: the page and any sub-sections in the same file (not child modules). */
function pageSections(core: StoreCore, section: SectionId): SectionNode[] {
  const st = core.st;
  const root = st.sections.get(section);
  if (!root) return [];
  const out: SectionNode[] = [];
  const walk = (n: SectionNode) => {
    out.push(n);
    for (const c of n.children) {
      const k = st.sections.get(c);
      if (k && k.file === root.file) walk(k);
    }
  };
  walk(root);
  return out;
}

/** Blocks of a module page whose text a model or a human wrote (what a re-partition must never lose). */
function authoredBlocks(core: StoreCore, section: SectionId): BlockRec[] {
  const out: BlockRec[] = [];
  for (const s of pageSections(core, section))
    for (const b of s.blocks) {
      const rec = core.st.blocks.get(b);
      if (rec && (rec.meta.origin === "ai" || rec.meta.origin === "human")) out.push(rec);
    }
  return out;
}

/** Member paths of a doc module row: the full list when the row carries it, else its ≤ 32 representatives. */
const membersOf = (e: DocModuleEntry): readonly string[] => (e.members && e.members.length > 0 ? e.members : e.reps);

/**
 * How well a vanished module row matches a new module: Jaccard over the full member lists when the row has them;
 * for a reps-only row (an older doc.index.json), the share of its representatives that the new module holds.
 */
export function partitionOverlap(prev: DocModuleEntry, paths: readonly string[]): number {
  const a = new Set(membersOf(prev));
  if (a.size === 0 || paths.length === 0) return 0;
  let inter = 0;
  for (const p of paths) if (a.has(p)) inter++;
  if (prev.members && prev.members.length > 0) return inter / (a.size + paths.length - inter);
  return inter / a.size;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const x = new Set(a);
  let inter = 0;
  for (const v of new Set(b)) if (x.has(v)) inter++;
  const union = x.size + new Set(b).size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Minimum overlap for a vanished module's page to follow a new module (EX-01). */
export const REATTACH_MIN = 0.6;

/**
 * EX-01: a re-partition (new path, fresh home, moved repo, teammate clone) gives some modules new ids. Their pages
 * held generated and human text; tombstoning them lost a paid generation that `.mitori/` (gitignored) cannot bring
 * back. A vanished row whose page has authored blocks hands its slug / section / name to the best-overlapping NEW
 * module (≥ {@link REATTACH_MIN}); with no such module the page is copied to `orphaned/<slug>.md` before it goes.
 */
function reattach(core: StoreCore, input: StaticDocInput): { inherit: Map<ModuleId, DocModuleEntry>; orphans: DocModuleEntry[]; moved: DocModuleEntry[] } {
  const st = core.st;
  const ids = new Set(input.modules.map((m) => m.id));
  const vanished = [...st.modules.values()].filter((e) => !ids.has(e.id) && authoredBlocks(core, e.section).length > 0);
  const inherit = new Map<ModuleId, DocModuleEntry>();
  const orphans: DocModuleEntry[] = [];
  const moved: DocModuleEntry[] = [];
  if (vanished.length === 0) return { inherit, orphans, moved };
  const fresh = input.modules.filter((m) => !st.modules.has(m.id));
  const pairs: { prev: DocModuleEntry; to: ModuleId; score: number; exact: boolean }[] = [];
  // a parent has no files of its own: it matches by its children (module ids that mostly survive a re-partition)
  const kidsOf = new Map<string, string[]>();
  for (const e of st.modules.values()) if (e.parent) kidsOf.set(e.parent, [...(kidsOf.get(e.parent) ?? []), e.id]);
  for (const prev of vanished) {
    const kids = kidsOf.get(prev.id) ?? [];
    for (const m of fresh) {
      const parent = kids.length > 0 && m.children.length > 0;
      const score = parent ? jaccard(kids, m.children) : partitionOverlap(prev, m.paths);
      if (score >= REATTACH_MIN) pairs.push({ prev, to: m.id, score, exact: score === 1 && (parent || !!prev.members?.length) });
    }
  }
  // best pairs first; ties: the module id order (deterministic)
  pairs.sort((x, y) => y.score - x.score || (x.prev.id < y.prev.id ? -1 : x.prev.id > y.prev.id ? 1 : x.to < y.to ? -1 : 1));
  const used = new Set<string>();
  for (const pr of pairs) {
    if (used.has(pr.prev.id) || inherit.has(pr.to)) continue;
    used.add(pr.prev.id);
    inherit.set(pr.to, pr.prev);
    if (!pr.exact) moved.push(pr.prev);
  }
  for (const prev of vanished) if (!used.has(prev.id)) orphans.push(prev);
  return { inherit, orphans, moved };
}

/** Create/update module entries and their `s6/<slug>` sections; removed modules lose their sections. */
function syncModules(core: StoreCore, input: StaticDocInput, res: ApplyResult): void {
  const st = core.st;
  const next = new Map<ModuleId, DocModuleEntry>();
  const taken = new Set<string>();
  const { inherit, orphans, moved } = reattach(core, input);
  const kept = new Set<SectionId>([...inherit.values()].map((e) => e.section));
  for (const [to, prev] of inherit) rekeySlots(core, prev.id, to);
  for (const m of input.modules) {
    const prev = st.modules.get(m.id) ?? inherit.get(m.id);
    const s = safeSlug(prev?.slug ?? m.slug, `${m.name} ${m.id}`);
    if (s.rewritten) core.notice("warn", "notice.slug.rewritten", { from: (prev?.slug ?? m.slug).slice(0, 60), to: s.slug });
    const slug = uniqueSlug(s.slug, taken);
    taken.add(slug);
    next.set(m.id, {
      id: m.id,
      section: `s6/${slug}` as SectionId,
      ifaceDigest: m.ifaceDigest,
      slug,
      name: prev?.name ?? m.name,
      ...(prev?.summary ? { summary: prev.summary } : {}),
      ...(m.parent ? { parent: m.parent } : {}),
      reps: [...m.paths].sort().slice(0, 32),
      // the exact partition, so a fresh index (new path / home) reproduces it instead of re-clustering (EX-01)
      ...(m.paths.length > 0 ? { members: [...m.paths].sort() } : {}),
    });
  }
  for (const prev of orphans) keepOrphan(core, prev);
  // a vanished parent must not take the pages of modules that are still here with it (EX-01: a parent's new id
  // cascaded into its 14 children, and every one of them became a 「未生成」 stub)
  const live = new Set<SectionId>([...next.values()].map((e) => `s6/${e.slug}` as SectionId));
  for (const [id, prev] of st.modules) if (!next.has(id) && !kept.has(prev.section)) removeSection(core, prev.section, res, live);
  for (const prev of moved) {
    // the page now describes a module whose files changed: its text may no longer fit
    const stale = authoredBlocks(core, prev.section)
      .filter((r) => r.meta.freshness !== "stale")
      .map((r) => {
        r.meta.freshness = "stale";
        st.touchMeta(r);
        return r.meta.id;
      });
    if (stale.length > 0) core.deps.events.emit({ type: "doc.freshness", blocks: stale, freshness: "stale", paths: [] });
    core.notice("warn", "notice.doc.moduleReattached", { module: prev.name.slice(0, 60), slug: prev.slug });
  }
  st.modules.clear();
  for (const [id, e] of next) st.modules.set(id, e);
  core.modulesChanged();
  const pages = modulePages(input, st.modules, (m) => (st.modules.get(m.id) as DocModuleEntry).slug);
  const s6 = st.sections.get("s6") as SectionNode;
  const kids = new Map<SectionId, SectionId[]>();
  for (const p of pages) {
    const id = `s6/${p.slug}` as SectionId;
    const parent = p.parent ? (st.modules.get(p.parent)?.section ?? "s6") : "s6";
    kids.set(parent, [...(kids.get(parent) ?? []), id]);
    const node = st.sections.get(id) ?? { id, title: p.name, file: st.fileOf(id), blocks: [], children: [], state: "static_only" as const, readingSec: 0 };
    node.title = p.name;
    node.module = p.module;
    st.sections.set(id, node);
  }
  for (const s of [s6, ...pages.map((p) => st.sections.get(`s6/${p.slug}` as SectionId) as SectionNode)]) {
    const want = kids.get(s.id) ?? [];
    if (want.join() !== s.children.join()) {
      s.children = want;
      st.touchOutline();
    }
  }
}

/** Module-page static slots `m:<from>:…` become `m:<to>:…` (same block ids: an inherited page keeps its bytes). */
function rekeySlots(core: StoreCore, from: ModuleId, to: ModuleId): void {
  const st = core.st;
  const pre = `m:${from}:`;
  for (const [slot, id] of [...st.slots]) {
    if (!slot.startsWith(pre)) continue;
    const next = `m:${to}:${slot.slice(pre.length)}`;
    st.slots.delete(slot);
    if (st.slots.has(next)) continue;
    st.slots.set(next, id);
    const rec = st.blocks.get(id);
    if (rec) {
      rec.meta.slot = next;
      st.touchMeta(rec);
    }
  }
}

/** Copy a vanished module's page (its file as last serialized) to `orphaned/<slug>.md` before its section goes. */
function keepOrphan(core: StoreCore, prev: DocModuleEntry): void {
  const sections = pageSections(core, prev.section);
  if (sections.length === 0) return;
  const text = core.orphanText(sections);
  if (text.trim() === "") return;
  core.orphans.set(`orphaned/${prev.slug}.md`, text);
  core.notice("warn", "notice.doc.moduleOrphaned", { module: prev.name.slice(0, 60), file: `orphaned/${prev.slug}.md` });
}

/** Tombstone a sub-section's blocks (and its children, except the `keep` ones: those are only unlinked) and unlink it. */
export function removeSection(core: StoreCore, id: SectionId, res?: ApplyResult, keep?: ReadonlySet<SectionId>): void {
  const st = core.st;
  const s = st.sections.get(id);
  if (!s || id === topOf(id)) return;
  for (const c of s.children) if (!keep?.has(c)) removeSection(core, c, res, keep);
  const gone = core.tombstone([...s.blocks]);
  res?.deleted.push(...gone);
  st.sections.delete(id);
  for (const p of st.sections.values()) if (p.children.includes(id)) p.children = p.children.filter((c) => c !== id);
  st.fileTick.set(st.fileOf(id), st.tick());
  st.touchOutline();
}

/**
 * A block with the slot's deterministic id but no slot metadata (the sidecar was lost, the Markdown kept the ids):
 * take it back as the static block — unlocked when its text is what the slot renders, else it stays a human edit.
 */
function adoptStatic(core: StoreCore, spec: StaticSpec): BlockId | undefined {
  const docId = core.st.manifest?.docId;
  if (!docId) return undefined;
  const id = staticBlockId(core.deps.hasher, docId, spec.slot);
  const rec = core.st.blocks.get(id);
  if (!rec || rec.meta.slot || rec.meta.section !== spec.section) return undefined;
  rec.meta.slot = spec.slot;
  core.st.slots.set(spec.slot, id);
  if (core.hash(spec.md) === rec.meta.hash) {
    rec.meta.origin = "static";
    delete rec.meta.lock;
  }
  core.st.touchMeta(rec);
  return id;
}

/** Create or update one static block; locked blocks get a proposal instead (once per text). */
function upsertStatic(core: StoreCore, spec: StaticSpec, res: ApplyResult): void {
  const st = core.st;
  if (!st.sections.has(spec.section)) return;
  let id = st.slots.get(spec.slot);
  if (!id) id = adoptStatic(core, spec);
  const rec = id ? st.blocks.get(id) : undefined;
  if (!rec) {
    const nid = core.staticId(spec.slot);
    const nrec = core.makeBlock({
      id: nid,
      section: spec.section,
      kind: spec.kind,
      marker: spec.md,
      origin: "static",
      depth: spec.depth,
      audience: spec.audience,
      slot: spec.slot,
      ...(spec.aspect ? { aspect: spec.aspect } : {}),
    });
    if (spec.diagram) {
      const dg = core.diagramId(spec.slot);
      st.diagrams.set(dg, irOf(spec.diagram, dg));
      nrec.meta.diagram = dg;
    }
    st.insertBlock(nrec, spec.section, core.insertIndex(spec.section, spec.rank));
    res.written.push(nid);
    return;
  }
  if (rec.meta.section !== spec.section) {
    const from = st.sections.get(rec.meta.section);
    if (from) {
      from.blocks = from.blocks.filter((b) => b !== rec.meta.id);
      st.renumber(from);
    }
    const to = st.sections.get(spec.section) as SectionNode;
    to.blocks.splice(core.insertIndex(spec.section, spec.rank), 0, rec.meta.id);
    st.renumber(to);
  }
  if (spec.diagram && rec.meta.diagram) {
    const ir = irOf(spec.diagram, rec.meta.diagram);
    const old = st.diagrams.get(rec.meta.diagram);
    if (!old || canonicalJson(old) !== canonicalJson(ir)) {
      st.diagrams.set(rec.meta.diagram, ir);
      st.touchIndex();
    }
  }
  if (core.hash(spec.md) === rec.meta.hash && rec.meta.kind === spec.kind) {
    res.unchanged.push(rec.meta.id);
    return;
  }
  if (rec.meta.lock) {
    // the human already has this text in front of them (pending) or turned it down (rejected): a static refresh (any
    // file save) never proposes it again — only a CHANGED generated text is news (ux finishing pass, cr-requests/ux.md #3)
    const seen = core.db.proposals({ block: rec.meta.id }).some((p) => p.md === spec.md && (p.state === "pending" || p.state === "rejected"));
    if (!seen)
      res.proposals.push(
        propose(
          core,
          {
            block: rec.meta.id,
            section: rec.meta.section,
            op: "update",
            baseHash: rec.meta.hash,
            md: spec.md,
            source: { kind: "regen", id: "static" },
            reason: "static",
          },
          { kind: spec.kind },
          false,
        ),
      );
    return;
  }
  rec.meta.kind = spec.kind;
  rec.meta.depth = spec.depth;
  rec.meta.audience = spec.audience;
  core.setText(rec, spec.md);
  res.written.push(rec.meta.id);
}

/** Slots owned by applyStatic (aspect and flow headings are owned by applyGenerated / upsertFlowSection). */
const isManagedSlot = (slot: string): boolean => !/:h:[a-z_]+$/.test(slot) && !/^s3:.+:h$/.test(slot);

function removeStatic(core: StoreCore, id: BlockId, res: ApplyResult): void {
  const rec = core.st.blocks.get(id);
  if (!rec) return;
  if (rec.meta.lock) {
    if (!core.db.proposals({ state: "pending", block: id }).some((p) => p.op === "delete"))
      res.proposals.push(
        propose(
          core,
          {
            block: id,
            section: rec.meta.section,
            op: "delete",
            baseHash: rec.meta.hash,
            md: "",
            source: { kind: "regen", id: "static" },
            reason: "static",
          },
          {},
          false,
        ),
      );
    return;
  }
  res.deleted.push(...core.tombstone([id]));
}

/** Build/refresh static sections + placeholders (deterministic slot ids). */
export function applyStatic(core: StoreCore, input: StaticDocInput): ApplyResult {
  const res = emptyResult();
  const st = core.st;
  const m = ensureManifest(core);
  m.coverage = { ...input.coverage };
  st.manifestTick = st.tick();
  core.lastStatic = input;
  stampGenerator(core);
  syncModules(core, input, res);
  // CR-PENDING(WP-04): estimates are not part of StaticDocInput yet (gen planner numbers, ux-R14 `SectionNode.est`)
  const est = (input as StaticDocInput & { estimates?: Estimates }).estimates ?? {};
  for (const [sid, e] of Object.entries(est)) {
    const node = st.sections.get(sid as SectionId);
    if (node && e) node.est = { inTokens: e.inTokens, outTokens: e.outTokens };
  }
  const lang = core.lang();
  const pages = modulePages(input, st.modules, (mi) => (st.modules.get(mi.id) as DocModuleEntry).slug);
  const specs: StaticSpec[] = [
    ...DOC_TEMPLATE.map(
      (t): StaticSpec => ({ slot: `${t.id}:h`, section: t.id, kind: "heading", md: sectionHeading(t.id, lang), depth: "L0", audience: [], rank: RANK.heading }),
    ),
    ...buildStatic(input, lang, st.modules, pages, core.db.decisions(), est),
    ...derived(core),
  ];
  // re-adopt id-matching blocks first, so a lost sidecar does not make static text look like content
  for (const s of specs) if (!st.slots.has(s.slot)) adoptStatic(core, s);
  specs.push(...placeholders(core, est, input.facts.filter((f) => f.kind === "schema").length));
  const want = new Set(specs.map((s) => s.slot));
  for (const [slot, id] of [...st.slots]) if (isManagedSlot(slot) && !want.has(slot)) removeStatic(core, id, res);
  for (const spec of specs) upsertStatic(core, spec, res);
  for (const s of st.sections.values()) syncAspectHeadings(core, s.id, res);
  core.schedule();
  return res;
}

/** Re-run the store-derived static blocks only (decisions, glossary, sources, meta, placeholders). */
export function refreshDerived(core: StoreCore, sections?: Iterable<SectionId>, opts: { sources?: boolean } = {}): void {
  if (!core.st.manifest) return;
  const res = emptyResult();
  const schema = core.lastStatic ? core.lastStatic.facts.filter((f) => f.kind === "schema").length : 0;
  // with `sections`, only those sections' placeholders (and the source index, which follows every claim change) are
  // revisited; applyStatic refreshes the rest
  const only = sections ? new Set(sections) : undefined;
  const specs = [
    ...(only ? [...(opts.sources === false ? [] : [sourcesSpec(core)]), ...metaSpec(core)] : derived(core)),
    ...placeholders(core, {}, schema, only),
  ];
  for (const spec of specs) upsertStatic(core, spec, res);
  const want = new Set(specs.map((s) => s.slot));
  const slots = only ? [...only].map((s) => placeholderSlot(core, s)) : [...core.st.slots.keys()].filter((s) => /:ph$/.test(s));
  // a placeholder whose section now has content goes away
  for (const slot of slots) {
    const id = core.st.slots.get(slot);
    if (id && !want.has(slot)) removeStatic(core, id, res);
  }
  if (!only && !core.st.glossary.length && core.st.slots.has("s12:table")) removeStatic(core, core.st.slots.get("s12:table") as BlockId, res);
}

/** Aspect headings exist exactly while their aspect has ≥ 1 block (§4.2). */
export function syncAspectHeadings(core: StoreCore, section: SectionId, res: ApplyResult): void {
  const st = core.st;
  const s = st.sections.get(section);
  if (!s) return;
  const lang = core.lang();
  const mod = s.module;
  const prefix = mod ? `m:${mod}` : section.startsWith("s3/") ? `s3:${section.slice(3)}` : section;
  const level = section.startsWith("s3/") ? "###" : "##";
  const present = new Set<BlockAspect>();
  for (const id of s.blocks) {
    const meta = st.blocks.get(id)?.meta;
    if (meta?.aspect && meta.origin !== "static") present.add(meta.aspect);
  }
  for (const aspect of Object.keys(ASPECT_HEADINGS) as BlockAspect[]) {
    const h = ASPECT_HEADINGS[aspect];
    if (!h) continue;
    const slot = `${prefix}:h:${aspect}`;
    const id = st.slots.get(slot);
    if (present.has(aspect)) {
      const md = `${level} ${h[lang]}`;
      if (!id) {
        const nid = core.staticId(slot);
        const rec = core.makeBlock({ id: nid, section, kind: "heading", marker: md, origin: "static", depth: "L1", audience: [], slot, aspect });
        st.insertBlock(rec, section, core.insertIndex(section, core.aspectIndexRank(section, aspect, true)));
        res.written.push(nid);
      } else {
        const rec = st.blocks.get(id) as BlockRec;
        if (rec.meta.hash !== core.hash(md) && !rec.meta.lock) {
          core.setText(rec, md);
          res.written.push(id);
        }
      }
    } else if (id) removeStatic(core, id, res);
  }
}

/**
 * Create a proposal row (external links counted) [SEC-11]. AI-origin md must pass the AI-Markdown rules; the store's
 * own static text (`aiOrigin = false`) is not AI output and may quote repo text (a TODO with `<div>`), so a locked
 * static block always gets its proposal.
 */
export function propose(
  core: StoreCore,
  p: Omit<DocProposal, "id" | "state" | "createdAt">,
  extra: import("./db.ts").ProposalExtra = {},
  aiOrigin = true,
): ProposalId {
  const v = core.deps.aiMarkdown.validate(p.md, { lang: core.lang(), allowRepoLinks: true });
  const id = core.deps.ids.next("proposal") as ProposalId;
  const row: DocProposal = { ...p, id, state: "pending", createdAt: core.now(), ...(v.externalLinks > 0 ? { externalLinks: v.externalLinks } : {}) };
  if (aiOrigin && !v.ok)
    throw new MitoriError("E_INVALID_INPUT", "proposal Markdown failed the AI-Markdown rules (V13)", { params: { first: v.errors[0]?.expected ?? "" } });
  // the base text must be in history for the sentence-level 3-way at accept time (static text has none of its own)
  const rec = p.block ? core.st.blocks.get(p.block) : undefined;
  if (rec && p.baseHash === rec.meta.hash) snapshot(core, rec);
  core.db.putProposal(row, extra);
  return id;
}

/** File-form md of generated marker md + its stamped claims (for proposals and history). */
function fileFormOf(core: StoreCore, section: SectionId, marker: string, claims: { cites: readonly Cite[] }[]): string {
  return unmarkerize(
    marker,
    claims.map((c, i) => ({ n: i + 1, cites: c.cites })),
    core.ctxOf(core.st.fileOf(section)),
  );
}

/**
 * Generated claims in marker order (marker without a claim → an inferred claim). Cite-group text written literally
 * into the md becomes a claim too (raw cites, stamped after the apply), exactly as the file would read it back.
 */
function orderedClaims(core: StoreCore, gb: GeneratedBlock, at: string): { marker: string; claims: GeneratedBlock["claims"] } {
  const code = gb.kind === "code" || gb.kind === "diagram";
  const top = Math.max(0, ...gb.claims.map((c) => c.n), ...markerPositions(gb.md).map((m) => m.n));
  const lit = code ? { md: gb.md, links: [] } : literalGroups(gb.md, core.lang(), core.ctxOf(core.st.fileOf(gb.section)), top + 1);
  const { md, order } = canonicalMarkers(lit.md);
  const byN = new Map(gb.claims.map((c) => [c.n, c]));
  for (const l of lit.links) {
    const cites = l.cites.map(rawCite);
    const checks = pendingChecks(at);
    byN.set(l.k, { n: l.k, kind: "fact", quote: "", cites, checks, verdict: verdictOf(checks, cites, undefined) });
  }
  return {
    marker: md,
    claims: order.map(
      (n, i) =>
        byN.get(n) ?? { n: i + 1, kind: "fact", quote: "", cites: [], checks: { l0: true, l1: "vacuous", l2: true, checkedAt: at }, verdict: "inferred" },
    ),
  };
}

/** Marker md for a generated block (diagram blocks get their Mermaid fence from the IR; an open fence is closed). */
function generatedMarker(gb: GeneratedBlock, marker: string): string {
  if (gb.kind !== "diagram" || !gb.diagram) return closeOpenFence(marker);
  const fence = `\`\`\`mermaid\n${toMermaidText({ ...gb.diagram, id: "dg_00000000" })}\`\`\``;
  return marker.trim() ? `${marker.trim()}\n\n${fence}` : fence;
}

/** Replace a block's claims, keeping ClaimIds by reuse / quote / cite set (§6.7-6). */
function replaceClaims(core: StoreCore, rec: BlockRec, claims: GeneratedBlock["claims"]): void {
  const st = core.st;
  const old = rec.meta.claims.map((id) => st.claims.get(id)?.claim).filter((c): c is Claim => c !== undefined);
  const free = new Set(old);
  const take = (pred: (c: Claim) => boolean): Claim | undefined => {
    for (const c of free)
      if (pred(c)) {
        free.delete(c);
        return c;
      }
    return undefined;
  };
  const key = (cs: readonly Cite[]) =>
    cs
      .map((c) => `${c.path}:${c.start}-${c.end}`)
      .sort()
      .join(",");
  const ids: ClaimId[] = [];
  for (const g of claims) {
    const keep = (g.reuse && take((c) => c.id === g.reuse)) || take((c) => c.quote !== "" && c.quote === g.quote) || take((c) => key(c.cites) === key(g.cites));
    if (keep) st.claims.delete(keep.id);
    const verdict = rec.meta.lock === "human-verified" ? "human-verified" : g.verdict;
    const cr = core.addClaim(rec.meta.id, { kind: g.kind, quote: g.quote, cites: g.cites, verdict, checks: g.checks }, keep?.id);
    core.db.putCites(cr.claim.id, rec.meta.id, g.cites);
    ids.push(cr.claim.id);
  }
  for (const d of free) st.claims.delete(d.id);
  core.db.dropCites([...free].map((d) => d.id));
  rec.meta.claims = ids;
}

/** Apply generated blocks (id-referenced upsert/delete, uniqueness enforced, locks ⇒ proposals). */
export function applyGenerated(core: StoreCore, blocks: GeneratedBlock[], opts: ApplyOptions): ApplyResult {
  const res = emptyResult();
  const st = core.st;
  ensureManifest(core);
  core.lastGenAt = core.deps.clock.now();
  const touched = new Set<SectionId>();
  // the appendix source index is rebuilt only when cited paths change (a full rebuild per apply costs GC)
  let sourcesChanged = false;
  const by: MessageAuthor = "agent:gen";
  for (const gb of blocks) {
    if (!st.sections.has(gb.section)) {
      core.log.warn("applyGenerated: unknown section", { section: gb.section });
      continue;
    }
    const { marker: m0, claims } = orderedClaims(core, gb, core.now());
    const marker = generatedMarker(gb, m0);
    const mdFile = fileFormOf(core, gb.section, marker, claims);
    const extra = {
      kind: gb.kind,
      ...(gb.aspect ? { aspect: gb.aspect } : {}),
      claims: claims.map((c) => ({ kind: c.kind, cites: c.cites, checks: c.checks, verdict: c.verdict })),
    };
    if (gb.id === null) {
      const after =
        gb.after === undefined || gb.after === null ? null : gb.after.startsWith("new:") ? (res.idMap[gb.after as NewBlockRef] ?? null) : (gb.after as BlockId);
      if (opts.mode === "propose") {
        res.proposals.push(
          propose(core, { block: null, section: gb.section, after, op: "insert", baseHash: null, md: mdFile, source: opts.source, reason: opts.reason }, extra),
        );
        continue;
      }
      const id = core.newBlockId();
      const rec = core.makeBlock({
        id,
        section: gb.section,
        kind: gb.kind,
        marker,
        origin: "ai",
        depth: gb.depth,
        audience: gb.audience,
        lang: gb.lang,
        ...(gb.aspect ? { aspect: gb.aspect } : {}),
      });
      rec.meta.gen = gb.gen;
      if (gb.diagram) {
        const dg = core.diagramId(`ai:${id}`);
        st.diagrams.set(dg, irOf(gb.diagram, dg));
        rec.meta.diagram = dg;
      }
      const anchor = after ? st.blocks.get(after) : undefined;
      const index =
        anchor && anchor.meta.section === gb.section
          ? (st.sections.get(gb.section) as SectionNode).blocks.indexOf(after as BlockId) + 1
          : core.insertIndex(gb.section, core.rankOf(rec.meta) ?? RANK.ph - 1);
      st.insertBlock(rec, gb.section, index);
      replaceClaims(core, rec, claims);
      if (claims.some((c) => c.cites.length > 0)) sourcesChanged = true;
      core.refreshQuotes(rec);
      st.touchText(rec);
      core.history(rec, by, "generate");
      if (gb.ref) res.idMap[gb.ref] = id;
      res.written.push(id);
      touched.add(gb.section);
      continue;
    }
    const rec = st.blocks.get(gb.id);
    if (!rec || rec.meta.origin === "static") {
      core.log.warn("applyGenerated: id not updatable", { block: gb.id });
      continue;
    }
    if (core.hash(marker) === rec.meta.hash) {
      res.unchanged.push(rec.meta.id);
      continue;
    }
    if (rec.meta.lock || opts.mode === "propose") {
      res.proposals.push(
        propose(
          core,
          { block: rec.meta.id, section: rec.meta.section, op: "update", baseHash: rec.meta.hash, md: mdFile, source: opts.source, reason: opts.reason },
          extra,
        ),
      );
      continue;
    }
    rec.meta.kind = gb.kind;
    rec.meta.depth = gb.depth;
    rec.meta.audience = gb.audience;
    rec.meta.gen = gb.gen;
    rec.meta.origin = "ai";
    if (gb.aspect) rec.meta.aspect = gb.aspect;
    if (gb.diagram) {
      const dg = rec.meta.diagram ?? core.diagramId(`ai:${rec.meta.id}`);
      st.diagrams.set(dg, irOf(gb.diagram, dg));
      rec.meta.diagram = dg;
    }
    core.setText(rec, marker);
    const before = citedPaths(core, rec);
    replaceClaims(core, rec, claims);
    if (before !== citedPaths(core, rec)) sourcesChanged = true;
    core.refreshQuotes(rec);
    core.history(rec, by, "regen");
    res.written.push(rec.meta.id);
    touched.add(rec.meta.section);
  }
  // deletes: the mass-delete guard sends the excess (from the end) to proposals (§6.7-4)
  const deletes = opts.deletes.filter((id) => st.blocks.has(id));
  const direct = opts.listed >= 4 && deletes.length > opts.listed / 2 ? Math.floor(opts.listed / 2) : deletes.length;
  deletes.forEach((id, i) => {
    const rec = st.blocks.get(id) as BlockRec;
    if (rec.meta.lock || rec.meta.origin !== "ai" || opts.mode === "propose" || i >= direct) {
      res.proposals.push(
        propose(core, { block: id, section: rec.meta.section, op: "delete", baseHash: rec.meta.hash, md: "", source: opts.source, reason: opts.reason }),
      );
      return;
    }
    touched.add(rec.meta.section);
    if (citedPaths(core, rec) !== "") sourcesChanged = true;
    res.deleted.push(...core.tombstone([id]));
  });
  for (const s of touched) syncAspectHeadings(core, s, res);
  stampGenerator(core, res.written);
  refreshDerived(core, touched, { sources: sourcesChanged });
  for (const s of touched) {
    const node = st.sections.get(s);
    if (node) st.refreshSection(node);
  }
  core.schedule();
  return res;
}

export { round4, verdictOf };
