// load(): docDir → model (§10.4). Markdown is canonical for text, `doc.index.json` for metadata. Imported text
// that differs from the sidecar hash locks the block `human-edited` (history `import_external`); blocks missing from
// Markdown are tombstoned; duplicate / tombstoned ids get fresh ids; id-less text becomes human blocks.
import {
  type BlockId,
  type CheckError,
  type Claim,
  type DocIndex,
  type DocManifest,
  type DocModuleEntry,
  FORMAT,
  type SectionId,
  type SectionNode,
} from "@mitori/core";
import { markerize } from "../codec/cite.ts";
import { parseDoc, reinterpret } from "../codec/parse.ts";
import type { CodecContext, DocLoadReport, ParsedDocFile } from "../contract.ts";
import { canonicalMarkers, matchGroups, pendingChecks, rawCite, sameRanges, verdictOf } from "./claims.ts";
import type { BlockRec, StoreCore } from "./core.ts";
import { safeSlug, topOf, uniqueSlug } from "./paths.ts";

const MAX_PROBLEMS = 20;
const dec = new TextDecoder();
type ParsedBlock = ParsedDocFile["blocks"][number];

export interface LoadIo {
  /** Read a docDir-relative file (null when missing). */
  read(rel: string): Promise<string | null>;
  /** Names in a docDir-relative directory. */
  list(rel: string): string[];
}

export interface LoadResult extends DocLoadReport {
  /** Files read and their bytes (ledger + "already canonical" detection). */
  seen: Map<string, string>;
  /** Claims whose cites came from Markdown and need stamping. */
  toStamp: Claim["id"][];
}

function problem(problems: CheckError[], at: string, expected: string, actual: string, code: CheckError["code"]): void {
  if (problems.length < MAX_PROBLEMS) problems.push({ at, expected, actual: actual.slice(0, 80), code });
}

/** Restore the model from a parsed sidecar (persisted `file` ignored, slugs validated). */
function restoreIndex(core: StoreCore, idx: DocIndex, problems: CheckError[]): void {
  const st = core.st;
  st.resetSections();
  st.blocks.clear();
  st.claims.clear();
  st.diagrams.clear();
  st.modules.clear();
  st.slots.clear();
  const slugRename = new Map<string, string>();
  const taken = new Set<string>();
  for (const m of idx.modules ?? []) {
    const s = safeSlug(m.slug, `${m.name} ${m.id}`);
    if (s.rewritten) {
      core.notice("warn", "notice.slug.rewritten", { from: m.slug.slice(0, 60), to: s.slug });
      problem(problems, `doc.index.json#/modules/${m.id}`, "slug matching SLUG_RE", m.slug, "E_FORMAT_INVALID");
    }
    const slug = uniqueSlug(s.slug, taken);
    taken.add(slug);
    if (slug !== m.slug) slugRename.set(m.section, `s6/${slug}`);
    const entry: DocModuleEntry = { ...m, slug, section: `s6/${slug}` as SectionId };
    st.modules.set(m.id, entry);
  }
  const rename = (id: SectionId): SectionId => (slugRename.get(id) as SectionId | undefined) ?? id;
  const known = new Set<SectionId>(st.sections.keys());
  // section tree (roots fixed; children kept when valid)
  for (const s of idx.sections ?? []) {
    const id = rename(s.id);
    const top = topOf(id);
    if (!st.sections.has(top)) continue;
    if (id !== top && !/^(s3|s6)\/[a-z0-9-]+$/.test(id)) continue;
    const node: SectionNode = st.sections.get(id) ?? { id, title: s.title, file: "", blocks: [], children: [], state: "static_only", readingSec: 0 };
    node.title = s.title;
    if (s.module) node.module = s.module;
    if (s.est) node.est = s.est;
    node.children = [];
    node.file = st.fileOf(id);
    st.sections.set(id, node);
    known.add(id);
  }
  for (const s of idx.sections ?? []) {
    const node = st.sections.get(rename(s.id));
    if (!node) continue;
    node.children = s.children.map(rename).filter((c) => st.sections.has(c) && c !== node.id);
  }
  for (const [id, meta] of Object.entries(idx.blocks ?? {}) as [BlockId, DocIndex["blocks"][BlockId]][]) {
    const section = rename(meta.section);
    if (!st.sections.has(section)) continue;
    const rec: BlockRec = { meta: { ...meta, id, section, file: st.fileOf(section) }, marker: "", tick: 0, citeTick: 0, metaTick: 0 };
    st.blocks.set(id, rec);
    if (meta.slot) st.slots.set(meta.slot, id);
  }
  for (const [id, c] of Object.entries(idx.claims ?? {}) as [Claim["id"], Claim][]) {
    if (!st.blocks.has(c.block)) continue;
    const cites = c.cites.map((x) => ({ ...x }));
    st.claims.set(id, { claim: { ...c, cites }, fileCites: cites, tick: 0 });
  }
  for (const [id, d] of Object.entries(idx.diagrams ?? {})) st.diagrams.set(id as DiagramIdOf, d);
  st.glossary = idx.glossary ?? [];
}
type DiagramIdOf = Parameters<StoreCore["st"]["diagrams"]["set"]>[0];

/** Parse JSON with the kind / schemaVersion guard. */
function readJson<T extends { kind: string; schemaVersion: number }>(
  text: string | null,
  kind: string,
  version: number,
  rel: string,
  problems: CheckError[],
): T | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as T;
    if (v.kind !== kind) {
      problem(problems, rel, `kind ${kind}`, String(v.kind), "E_FORMAT_INVALID");
      return null;
    }
    if (v.schemaVersion > version) {
      problem(problems, rel, `schemaVersion ≤ ${version}`, String(v.schemaVersion), "E_FORMAT_TOO_NEW");
      return null;
    }
    return v;
  } catch (e) {
    problem(problems, rel, "valid JSON", e instanceof Error ? e.message : String(e), "E_FORMAT_INVALID");
    return null;
  }
}

/** Reconcile Markdown files with the model (`only` = the files that changed on disk; null = all). */
async function reconcile(core: StoreCore, io: LoadIo, report: LoadResult, initial: boolean, only: Set<string> | null): Promise<void> {
  const st = core.st;
  const files = new Map(st.files().map((f) => [f.rel, f.sections]));
  // module pages on disk that the index does not know are read too (their text must not be lost)
  for (const name of io.list("doc/modules")) {
    const m = /^([a-z0-9][a-z0-9-]*)\.md$/.exec(name);
    if (!m || files.has(`doc/modules/${name}`) || safeSlug(m[1] as string, "x").rewritten) continue;
    const id = `s6/${m[1]}` as SectionId;
    st.sections.set(id, { id, title: m[1] as string, file: `doc/modules/${name}`, blocks: [], children: [], state: "static_only", readingSec: 0 });
    (st.sections.get("s6") as SectionNode).children.push(id);
    files.set(`doc/modules/${name}`, [st.sections.get(id) as SectionNode]);
  }
  if (only) for (const rel of [...files.keys()]) if (!only.has(rel)) files.delete(rel);
  const seen = new Set<BlockId>();
  const missing = new Set<string>();
  const order = new Map<SectionId, BlockId[]>();
  for (const sections of files.values()) for (const s of sections) order.set(s.id, []);
  for (const [rel, sections] of files) {
    const text = await io.read(rel);
    if (text === null) {
      missing.add(rel);
      continue;
    }
    report.seen.set(rel, text);
    const ctx = core.ctxOf(rel);
    const parsed = parseDoc(text, rel, ctx);
    for (const p of parsed.problems) problem(report.problems, p.at, p.expected, p.actual, p.code);
    if (text.includes("\r")) core.log.info("normalized CRLF", { file: rel });
    const sectionIds = new Set(sections.map((s) => s.id));
    let section: SectionId = (sections[0] as SectionNode).id;
    for (const pb of parsed.blocks) {
      let id = pb.id;
      // a duplicate across files, or a tombstoned id coming back (merge of another branch), gets a fresh id
      if (id && (seen.has(id) || (core.tombs.has(id) && !st.blocks.has(id)))) id = null;
      let rec = id ? st.blocks.get(id) : undefined;
      if (rec && sectionIds.has(rec.meta.section)) section = rec.meta.section;
      if (!id) {
        id = core.newBlockId();
        report.assignedIds.push(id);
      }
      const isNew = !rec;
      if (!rec) {
        rec = core.makeBlock({ id, section, kind: pb.kindHint, marker: "", origin: "human" });
        rec.meta.lock = "human-edited";
        st.blocks.set(id, rec);
      }
      seen.add(id);
      (order.get(section) as BlockId[]).push(id);
      rec.meta.section = section;
      rec.meta.file = rel;
      importText(core, rec, pb, ctx, report, isNew, initial);
    }
  }
  for (const [sid, ids] of order) {
    const s = st.sections.get(sid);
    if (s) s.blocks = ids;
  }
  // blocks the Markdown no longer has: tombstoned (§10.4-6). Static blocks of a missing file are just dropped;
  // the next applyStatic recreates them with the same ids.
  const orphans: BlockId[] = [];
  for (const [id, rec] of [...st.blocks]) {
    if (seen.has(id) || !files.has(rec.meta.file)) continue;
    if (missing.has(rec.meta.file) && rec.meta.origin === "static") st.dropBlock(id);
    else orphans.push(id);
  }
  report.orphaned = core.tombstone(orphans);
  for (const sid of order.keys()) {
    const s = st.sections.get(sid);
    if (s) st.renumber(s);
  }
}

/** Import one parsed block's text into its record (claims matched to the link groups, external edits locked). */
function importText(core: StoreCore, rec: BlockRec, pb: ParsedBlock, ctx: CodecContext, report: LoadResult, isNew: boolean, initial: boolean): void {
  const st = core.st;
  let md = pb.md;
  const asKind = reinterpret(pb.md, pb.kindHint, rec.meta.kind, ctx.lang);
  if (asKind !== null) md = asKind;
  else rec.meta.kind = pb.kindHint;
  const code = rec.meta.kind === "code" || rec.meta.kind === "diagram";
  const { md: m0, links } = code ? { md, links: [] } : markerize(md, ctx.lang, ctx);
  const marker = canonicalMarkers(m0).md;
  const changed = isNew || core.hash(marker) !== rec.meta.hash;
  const old = rec.meta.claims.map((c) => st.claims.get(c)?.claim).filter((c): c is Claim => c !== undefined);
  const { matched, dropped } = matchGroups(links, old);
  for (const d of dropped) st.claims.delete(d.id);
  core.db.dropCites(dropped.map((d) => d.id));
  rec.meta.claims = links.map((g, i) => {
    const cr = matched[i] ? st.claims.get((matched[i] as Claim).id) : undefined;
    if (cr) {
      if (!sameRanges(g, cr.fileCites)) {
        // the Markdown carries other ranges than the sidecar (an edited link, or another machine's cite flush)
        cr.fileCites = g.cites.map(rawCite);
        if (!sameRanges(g, cr.claim.cites)) {
          core.setLiveCites(cr, g.cites.map(rawCite));
          report.toStamp.push(cr.claim.id);
        }
        st.touchClaim(cr);
      }
      return cr.claim.id;
    }
    const cites = g.cites.map(rawCite);
    const checks = pendingChecks(core.now());
    const nc = core.addClaim(rec.meta.id, { kind: "fact", quote: "", cites, verdict: verdictOf(checks, cites, rec.meta.lock), checks });
    if (cites.length > 0) report.toStamp.push(nc.claim.id);
    return nc.claim.id;
  });
  core.setText(rec, marker);
  core.refreshQuotes(rec);
  if (!changed) return;
  if (!isNew) {
    if (rec.meta.lock !== "human-verified") rec.meta.lock = "human-edited";
    rec.meta.origin = "human";
    report.externallyEdited.push(rec.meta.id);
  }
  if (!isNew || !initial) core.history(rec, "human", "import_external");
}

/** Load (or re-load) the doc directory. */
export async function loadDoc(core: StoreCore, io: LoadIo, opts: { initial: boolean; indexChanged: boolean; only: Set<string> | null }): Promise<LoadResult> {
  const report: LoadResult = { manifest: null, externallyEdited: [], assignedIds: [], orphaned: [], problems: [], seen: new Map(), toStamp: [] };
  const manifestText = await io.read("mitori.json");
  if (manifestText !== null) report.seen.set("mitori.json", manifestText);
  if (opts.initial || opts.indexChanged || !core.st.manifest) {
    const manifest = readJson<DocManifest>(manifestText, "mitori/doc-manifest", FORMAT.docManifest, "mitori.json", report.problems);
    if (manifest) {
      core.st.manifest = manifest;
      core.st.manifestTick = core.st.tick();
    }
  }
  report.manifest = core.st.manifest;
  const reindex = opts.initial || opts.indexChanged;
  if (reindex) {
    const indexText = await io.read("doc.index.json");
    if (indexText !== null) report.seen.set("doc.index.json", indexText);
    const idx = readJson<DocIndex>(indexText, "mitori/doc-index", FORMAT.docIndex, "doc.index.json", report.problems);
    if (idx) restoreIndex(core, idx, report.problems);
    // live cite positions (re-anchoring) win over the sidecar's last cite flush
    for (const [claim, cites] of core.db.liveCites()) {
      const c = core.st.claims.get(claim);
      if (c) c.claim.cites = cites;
    }
  }
  // the sidecar keeps only block metadata; the text comes from Markdown
  await reconcile(core, io, report, opts.initial, reindex ? null : opts.only);
  const now = core.deps.clock.now();
  for (const rec of core.st.blocks.values()) {
    for (const cid of rec.meta.claims) {
      const c = core.st.claims.get(cid);
      if (!c) continue;
      if (rec.meta.lock === "human-verified") c.claim.verdict = "human-verified";
      if (c.claim.cites !== c.fileCites && !sameRanges({ k: 0, inferred: false, cites: c.claim.cites }, c.fileCites)) core.st.touchCites(rec, now);
    }
  }
  core.st.touchOutline();
  return report;
}

export const decodeUtf8 = (b: Uint8Array): string => dec.decode(b);
