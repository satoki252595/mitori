// The DocStore: one per workspace, single writer. Synchronous mutators run inside the caller's write slot;
// `editBlock` stamps outside the queue and enters it itself; `load` may run inside a slot (file reads only);
// `flush` never enters the queue (internal serialization) so it can be reserved from inside a slot.
import {
  type Block,
  type BlockId,
  type Claim,
  type ClaimId,
  type Decision,
  type DocIndex,
  type DocLang,
  type DocManifest,
  type DocProposal,
  glossaryId,
  MitoriError,
  type ProposalId,
  type ReadingPath,
  type SectionId,
  type SectionNode,
  unsupported,
} from "@mitori/core";
import { markerize } from "../codec/cite.ts";
import { toRomaji } from "../codec/romaji.ts";
import { claimSpans } from "../codec/spans.ts";
import type { ClaimSpan, DocLoadReport, DocStore } from "../contract.ts";
import { finishBody, planBody } from "../render/body.ts";
import { htmlText } from "../render/text.ts";
import { applyGenerated, applyStatic, ensureManifest, propose, refreshDerived, removeSection } from "./apply.ts";
import { canonicalMarkers, matchGroups, rawCite, sameRanges, verdictOf } from "./claims.ts";
import { type BlockRec, StoreCore, type StoreDeps } from "./core.ts";
import { acceptProposal, cleanMd, snapshot, undoAccept } from "./edit.ts";
import { Flusher } from "./flush.ts";
import { type LoadIo, loadDoc } from "./load.ts";
import { resolveDocDir } from "./paths.ts";
import { indexObject } from "./serialize.ts";
import { inline } from "./static.ts";

const dec = new TextDecoder();
const FLOW_KEY = /^[a-z0-9][a-z0-9-]{0,46}$/;

/** Default reading paths (gen §4.3, zero tokens). */
function readingPaths(core: StoreCore): ReadingPath[] {
  const st = core.st;
  st.settle();
  const lang = core.lang();
  const sec = (ids: SectionId[]) => ids.filter((id) => st.sections.has(id));
  const time = (ids: SectionId[]) => ids.reduce((a, id) => a + (st.sections.get(id)?.readingSec ?? 0), 0);
  // §6 lists the top-level module pages by rank (descending), and that order is persisted with the section tree
  const topModules = (st.sections.get("s6")?.children ?? []).filter((s) => st.sections.has(s)).slice(0, 2);
  const defs: [string, string, string, ReadingPath["audience"], SectionId[]][] = [
    ["5min", "5 分コース", "5-minute tour", "newcomer", sec(["s0", "s1", "s2", "s3"])],
    ["30min", "30 分コース", "30-minute tour", "newcomer", sec(["s0", "s1", "s2", "s3", "s4", "s5", ...topModules])],
    ["reviewer", "レビュアー向け", "For reviewers", "reviewer", sec(["s6", "s9", "s10", "s11", "s13"])],
    ["pm", "PM 向け", "For PMs", "pm", sec(["s0", "s1", "s3", "s11", "s13"])],
    ["sre", "SRE 向け", "For SREs", "sre", sec(["s4", "s8", "s9", "s11"])],
  ];
  return defs.map(([id, ja, en, audience, ids]) => ({
    id,
    title: lang === "ja" ? ja : en,
    audience,
    steps: ids.map((section) => ({ section })),
    readingSec: time(ids),
  }));
}

class Store implements DocStore {
  readonly core: StoreCore;
  readonly flusher: Flusher;
  private loaded = false;
  private stamping: Promise<void> = Promise.resolve();
  private textMemo = new Map<BlockId, { hash: string; text: string }>();
  private citing: Map<string, Set<ClaimId>> | null = null;
  private decisionFiles = new Map<string, string>();

  constructor(deps: StoreDeps) {
    this.core = new StoreCore(deps);
    this.flusher = new Flusher(this.core);
    this.core.schedule = () => {
      this.citing = null;
      this.flusher.schedule();
    };
    this.core.readingPaths = () => readingPaths(this.core);
  }

  private get st() {
    return this.core.st;
  }

  /** Resolves when background re-stamping (load / accept) has been applied (tests, shutdown). */
  settled(): Promise<void> {
    return this.stamping;
  }

  /* ---------------------------------------------------------------- load */

  async load(): Promise<DocLoadReport> {
    const core = this.core;
    const fs = core.deps.fs;
    try {
      core.docDir = resolveDocDir(core.deps.ws, fs);
      core.docDirError = null;
    } catch (e) {
      core.docDirError = e as Error;
      const err = MitoriError.from(e);
      core.notice("error", "notice.doc.notOwned", { docDir: core.deps.ws.docDir, code: err.code });
      return {
        manifest: this.st.manifest,
        externallyEdited: [],
        assignedIds: [],
        orphaned: [],
        problems: [{ at: core.deps.ws.docDir, expected: "docDir inside the working tree, no symlinks", actual: err.message, code: err.code }],
      };
    }
    if (!fs) {
      // CR-PENDING(WP-04): createDocStore has no FsReader yet — without one there is nothing to read
      core.log.warn("load without FsReader: starting from an empty doc");
      return { manifest: this.st.manifest, externallyEdited: [], assignedIds: [], orphaned: [], problems: [] };
    }
    const root = core.docDir.rootReal;
    if (this.loaded) await this.flusher.flush(false).catch(() => []);
    // nothing is read through a symlink inside docDir either (`doc/` → elsewhere would import foreign files)
    const io: LoadIo = {
      async read(rel) {
        const abs = `${root}/${rel}`;
        const st = fs.stat(abs);
        if (!st?.isFile || st.isSymlink || (rel.includes("/") && fs.realpath(abs) !== abs)) return null;
        return dec.decode(await fs.read(abs));
      },
      list: (rel) => (fs.realpath(`${root}/${rel}`) === `${root}/${rel}` ? (fs.readdir(`${root}/${rel}`) ?? []) : []),
    };
    const changed = (rel: string, text: string | null) => text !== null && text !== this.flusher.written.get(rel);
    let only: Set<string> | null = null;
    let indexChanged = !this.loaded;
    if (this.loaded) {
      indexChanged = changed("doc.index.json", await io.read("doc.index.json"));
      if (!indexChanged) {
        only = new Set();
        for (const { rel } of this.st.files()) if (changed(rel, await io.read(rel))) only.add(rel);
        for (const name of io.list("doc/modules")) if (!this.flusher.written.has(`doc/modules/${name}`)) only.add(`doc/modules/${name}`);
        if (only.size === 0) {
          // nothing but our own writes (the watcher echo of a flush): no reconcile, no outline event
          await this.loadDecisions(io);
          return { manifest: this.st.manifest, externallyEdited: [], assignedIds: [], orphaned: [], problems: [] };
        }
      }
    }
    const report = await loadDoc(core, io, { initial: !this.loaded, indexChanged, only, base: (rel) => this.flusher.written.get(rel) });
    this.loaded = true;
    await this.loadDecisions(io);
    // what is on disk is what we hold now; files whose canonical text differs stay dirty
    for (const [rel, text] of report.seen) this.flusher.adopt(rel, text, this.cleanTick(rel, text));
    if (report.externallyEdited.length > 0) core.notice("info", "notice.doc.externalEdit", { blocks: report.externallyEdited.length });
    if (report.toStamp.length > 0) this.restamp(report.toStamp);
    this.citing = null;
    core.deps.events.emit({ type: "doc.outline", outlineRev: this.st.outlineRev });
    core.schedule();
    return {
      manifest: report.manifest,
      externallyEdited: report.externallyEdited,
      assignedIds: report.assignedIds,
      orphaned: report.orphaned,
      problems: report.problems,
    };
  }

  /** The tick to record for a just-read file: current when our serialization equals the bytes, else "dirty". */
  private cleanTick(rel: string, text: string): number {
    const st = this.st;
    // the reconcile may have changed metadata (imports, orphans, assigned ids) even when no Markdown file is
    // rewritten: leave the sidecar dirty, the next flush writes it only if its bytes differ
    if (rel === "doc.index.json") return -1;
    if (rel === "mitori.json") return st.manifestTick;
    const f = st.files().find((x) => x.rel === rel);
    if (!f) return -1;
    const ours = `${st
      .blocksOfFile(f.sections)
      .map((r) => this.fragment(r))
      .join("\n\n")}\n`;
    return ours === text ? (st.fileTick.get(rel) ?? 0) : -1;
  }

  private fragment(r: BlockRec): string {
    return this.flusher.fragmentOf(r);
  }

  private async loadDecisions(io: LoadIo): Promise<void> {
    for (const name of io.list("decisions")) {
      if (!/^dc_[0-9a-hjkmnp-tv-z]{8}\.md$/.test(name)) continue;
      const rel = `decisions/${name}`;
      const text = await io.read(rel);
      if (text === null) continue;
      this.decisionFiles.set(rel, text);
      this.flusher.adopt(rel, text, 0);
      const id = /^- id: (dc_[0-9a-z]{8})$/m.exec(text)?.[1];
      if (!id || `decisions/${id}.md` !== rel) continue;
      const prev = this.core.db.decisions().find((d) => d.id === id);
      const status = /^- status: (accepted|superseded)$/m.exec(text)?.[1] as Decision["status"] | undefined;
      const decided = /^- decided: (\S+)$/m.exec(text)?.[1];
      const title = /^# DC: (.+)$/m.exec(text)?.[1] ?? prev?.title ?? id;
      this.core.db.putDecision({
        ...(prev ?? { blocks: [], cites: [] }),
        id: id as Decision["id"],
        title,
        status: status ?? prev?.status ?? "accepted",
        file: rel,
        decidedAt: decided ?? prev?.decidedAt ?? "",
      });
    }
  }

  /** Stamp cites taken from Markdown outside the queue, then apply them inside it. */
  private restamp(ids: ClaimId[]): void {
    if (ids.length === 0) return;
    const core = this.core;
    const run = async () => {
      const jobs = ids.flatMap((id) => {
        const c = this.st.claims.get(id);
        const rec = c ? this.st.blocks.get(c.claim.block) : undefined;
        if (!c || !rec) return [];
        const k = rec.meta.claims.indexOf(id);
        const span: ClaimSpan = claimSpans(rec.marker)[k] ?? { n: k + 1, start: 0, end: 0, quote: c.claim.quote, identifiers: [] };
        return [{ id, before: c.claim.cites, raw: c.claim.cites.map(({ path, start, end }) => ({ path, start, end })), span }];
      });
      const out = await Promise.all(jobs.map(async (j) => ({ j, r: await core.deps.stamper.stamp(j.raw, j.span).catch(() => null) })));
      await core.deps.write("doc.restamp", () => {
        const updated: Claim[] = [];
        for (const { j, r } of out) {
          const c = this.st.claims.get(j.id);
          const rec = c ? this.st.blocks.get(c.claim.block) : undefined;
          if (!c || !rec || !r || c.claim.cites !== j.before) continue;
          const sameAsFile = c.fileCites === j.before || sameRanges({ k: 0, inferred: false, cites: r.cites }, c.fileCites);
          core.setLiveCites(c, r.cites);
          if (sameAsFile) c.fileCites = r.cites;
          else this.st.touchCites(rec, core.deps.clock.now());
          c.claim.checks = r.checks;
          c.claim.verdict = verdictOf(r.checks, r.cites, rec.meta.lock);
          this.st.touchClaim(c);
          updated.push(c.claim);
        }
        if (updated.length > 0)
          core.deps.events.emit({ type: "doc.claims", claims: updated.map(({ id, block, verdict, checks }) => ({ id, block, verdict, checks })) });
        core.schedule();
      });
    };
    this.stamping = this.stamping.then(run).catch((e: unknown) => core.log.warn("restamp failed", { error: e instanceof Error ? e.message : String(e) }));
  }

  /* ---------------------------------------------------------------- reads */

  manifest(): DocManifest | null {
    return this.st.manifest;
  }

  index(): DocIndex {
    return indexObject(this.st, readingPaths(this.core));
  }

  sections(): SectionNode[] {
    return this.st.orderedSections();
  }

  section(id: SectionId): { node: SectionNode; blocks: Block[] } | null {
    this.st.settle();
    const node = this.st.sections.get(id);
    if (!node) return null;
    return { node, blocks: node.blocks.map((b) => this.st.toBlock(this.st.blocks.get(b) as BlockRec)) };
  }

  block(id: BlockId): Block | null {
    const r = this.st.blocks.get(id);
    return r ? this.st.toBlock(r) : null;
  }

  markerForm(id: BlockId): string | null {
    return this.st.blocks.get(id)?.marker ?? null;
  }

  blockText(id: BlockId): string | null {
    const r = this.st.blocks.get(id);
    if (!r) return null;
    const m = this.textMemo.get(id);
    const key = `${r.meta.hash}:${r.meta.kind}`;
    if (m && m.hash === key) return m.text;
    const text = htmlText(finishBody(planBody(this.st.toBlock(r), r.meta.lang, new Map())));
    this.textMemo.set(id, { hash: key, text });
    return text;
  }

  claims(block: BlockId): Claim[] {
    const r = this.st.blocks.get(block);
    return r ? this.st.claimsOf(r).map((c) => c.claim) : [];
  }

  blocksCiting(path: string, start?: number, end?: number): BlockId[] {
    if (!this.citing) {
      this.citing = new Map();
      for (const c of this.st.claims.values())
        for (const ct of c.claim.cites) this.citing.set(ct.path, (this.citing.get(ct.path) ?? new Set()).add(c.claim.id));
    }
    const out = new Set<BlockId>();
    for (const cid of this.citing.get(path) ?? []) {
      const c = this.st.claims.get(cid)?.claim;
      if (!c) continue;
      if (start === undefined || c.cites.some((ct) => ct.path === path && ct.start <= (end ?? start) && ct.end >= start)) out.add(c.block);
    }
    return [...out];
  }

  /* ---------------------------------------------------------------- writes */

  /** CR m1-46: the serializer's line of the block (WP-04 implements; the server derives `mdLine` until then). */
  mdLine(id: BlockId): number | null {
    return unsupported("doc.mdLine (WP-04, CR m1-46)", id);
  }

  /**
   * CR m1-50: manifest stamp at the end of a generation run (gen §10.8, AC-29): usage accumulates, effort and snapshot
   * follow the run, `generatedAt` moves only for a full run. Gen's orchestrator calls it in the run's final slot.
   */
  stampRun(run: Parameters<DocStore["stampRun"]>[0]): DocManifest {
    const m = ensureManifest(this.core);
    const u = m.usageTotals;
    const next: DocManifest = {
      ...m,
      effort: run.effort,
      snapshot: { ...run.snapshot },
      usageTotals: {
        calls: u.calls + run.usage.calls,
        in: u.in + run.usage.in,
        cacheWrite: u.cacheWrite + run.usage.cacheWrite,
        cacheRead: u.cacheRead + run.usage.cacheRead,
        out: u.out + run.usage.out,
        apiUsd: Math.round((u.apiUsd + run.usage.apiUsd) * 1e6) / 1e6,
      },
      generatedAt: run.full ? this.core.deps.clock.iso() : m.generatedAt,
    };
    this.st.manifest = next;
    this.st.manifestTick = this.st.tick();
    this.core.schedule();
    return next;
  }

  ensureManifest(): DocManifest {
    const had = this.st.manifest !== null;
    const m = ensureManifest(this.core);
    if (!had) this.core.schedule();
    return m;
  }

  applyStatic(input: Parameters<DocStore["applyStatic"]>[0]) {
    const res = applyStatic(this.core, input);
    this.core.deps.events.emit({ type: "doc.outline", outlineRev: this.st.outlineRev });
    return res;
  }

  applyGenerated(blocks: Parameters<DocStore["applyGenerated"]>[0], opts: Parameters<DocStore["applyGenerated"]>[1]) {
    const res = applyGenerated(this.core, blocks, opts);
    // cite links the generated md carried literally have raw cites (no blob yet): stamp them like imported links
    const raw = res.written.flatMap((id) =>
      this.claims(id)
        .filter((c) => c.cites.some((ct) => ct.blob === ""))
        .map((c) => c.id),
    );
    if (raw.length > 0) this.restamp(raw);
    return res;
  }

  setModuleLabels(labels: Parameters<DocStore["setModuleLabels"]>[0]): void {
    for (const l of labels) {
      const e = this.st.modules.get(l.module);
      if (!e) continue;
      e.name = l.name;
      if (l.summary !== undefined) e.summary = l.summary;
      const node = this.st.sections.get(e.section);
      if (node) node.title = l.name;
    }
    this.st.touchOutline();
    if (this.core.lastStatic) this.applyStatic(this.core.lastStatic);
    else this.core.schedule();
  }

  upsertFlowSection(key: string, title: string, order: number): SectionNode {
    if (!FLOW_KEY.test(key)) throw new MitoriError("E_INVALID_INPUT", "flow key must match [a-z0-9-]", { params: { key } });
    ensureManifest(this.core);
    const st = this.st;
    const id = `s3/${key}` as SectionId;
    const s3 = st.sections.get("s3") as SectionNode;
    const node = st.sections.get(id) ?? { id, title, file: st.fileOf(id), blocks: [], children: [], state: "pending" as const, readingSec: 0 };
    node.title = title;
    st.sections.set(id, node);
    const kids = s3.children.filter((c) => c !== id);
    kids.splice(Math.max(0, Math.min(order, kids.length)), 0, id);
    s3.children = kids;
    for (const [i, cid] of kids.entries()) this.flowHeading(cid, i + 1);
    st.touchOutline();
    this.core.schedule();
    return node;
  }

  private flowHeading(id: SectionId, k: number): void {
    const st = this.st;
    const node = st.sections.get(id);
    if (!node) return;
    const slot = `s3:${id.slice(3)}:h`;
    const md = `## 3.${k} ${inline(node.title)}`;
    const bid = st.slots.get(slot);
    const rec = bid ? st.blocks.get(bid) : undefined;
    if (!rec) {
      const nid = this.core.staticId(slot);
      st.insertBlock(this.core.makeBlock({ id: nid, section: id, kind: "heading", marker: md, origin: "static", depth: "L1", audience: [], slot }), id, 0);
    } else if (rec.meta.hash !== this.core.hash(md)) {
      if (rec.meta.lock)
        propose(
          this.core,
          {
            block: rec.meta.id,
            section: id,
            op: "update",
            baseHash: rec.meta.hash,
            md,
            source: { kind: "regen", id: "static" },
            reason: "static",
          },
          {},
          false,
        );
      else this.core.setText(rec, md);
    }
  }

  removeSection(id: SectionId): void {
    removeSection(this.core, id);
    if (id.startsWith("s3/")) for (const [i, cid] of (this.st.sections.get("s3") as SectionNode).children.entries()) this.flowHeading(cid, i + 1);
    refreshDerived(this.core);
    this.core.schedule();
  }

  setGlossary(entries: Parameters<DocStore["setGlossary"]>[0]): void {
    const docId = ensureManifest(this.core).docId;
    const st = this.st;
    const reading = st.orderedSections().flatMap((s) => s.blocks);
    const out = entries.map((e) => {
      const usedIn = reading.filter((b) => {
        const r = st.blocks.get(b);
        return !!r && r.meta.slot !== "s12:table" && r.marker.includes(e.term);
      });
      return {
        id: glossaryId(this.core.deps.hasher, docId, e.term),
        term: e.term,
        ...(e.yomi ? { yomi: e.yomi, romaji: toRomaji(e.yomi) } : {}),
        ...(e.en ? { en: e.en } : {}),
        definition: e.definition,
        usedIn,
        ...(e.symbol ? { symbol: e.symbol } : {}),
      };
    });
    out.sort((a, b) => {
      const ka = a.yomi ?? a.term;
      const kb = b.yomi ?? b.term;
      return ka < kb ? -1 : ka > kb ? 1 : a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
    });
    st.glossary = out;
    st.touchIndex();
    refreshDerived(this.core);
    this.core.schedule();
  }

  async editBlock(id: BlockId, baseHash: string, md: string, by: Parameters<DocStore["editBlock"]>[3]) {
    const core = this.core;
    const rec0 = this.st.blocks.get(id);
    if (!rec0) throw new MitoriError("E_NOT_FOUND", `no block ${id}`);
    if (rec0.meta.hash !== baseHash) throw new MitoriError("E_DOC_BASE_MISMATCH", "the block changed since the edit started");
    const code = rec0.meta.kind === "code" || rec0.meta.kind === "diagram";
    const text = cleanMd(md, rec0.meta.kind);
    const { md: m0, links } = code ? { md: text, links: [] } : markerize(text, core.lang(), core.ctxOf(rec0.meta.file));
    const marker = canonicalMarkers(m0).md;
    const spans = claimSpans(marker);
    const old = this.st.claimsOf(rec0).map((c) => c.claim);
    const { matched, dropped } = matchGroups(links, old, false);
    // stamp new / changed ranges outside the queue (git reads) [CONS-06]
    const stamped = await Promise.all(
      links.map(async (g, i) => {
        const m = matched[i] ?? null;
        if (m && sameRanges(g, m.cites)) return { m, cites: m.cites, checks: m.checks, fresh: false };
        const span = spans[i] ?? { n: i + 1, start: 0, end: 0, quote: "", identifiers: [] };
        const r = await core.deps.stamper.stamp(g.cites, span);
        return { m, cites: r.cites, checks: r.checks, fresh: true };
      }),
    );
    return await core.deps.write("doc.editBlock", () => {
      const rec = this.st.blocks.get(id);
      if (!rec || rec.meta.hash !== baseHash) throw new MitoriError("E_DOC_BASE_MISMATCH", "the block changed while its cites were being stamped");
      snapshot(core, rec);
      rec.meta.lock = "human-edited";
      delete rec.meta.verifiedBy;
      rec.meta.origin = "human";
      // a human writing into a placeholder makes it prose of its own: it leaves the placeholder slot, so the section
      // HAS content and no static refresh proposes 「この節はまだ生成されていません」 back over the human's text
      // (ux finishing pass, cr-requests/ux.md #3 — seen in the co-editing flow)
      if (rec.meta.kind === "placeholder") {
        rec.meta.kind = "prose";
        // and it reads as text, not as the 未生成 card with a 生成する button around the human's words
        rec.meta.status = "ready";
        if (rec.meta.slot && this.st.slots.get(rec.meta.slot) === id) this.st.slots.delete(rec.meta.slot);
        delete rec.meta.slot;
      }
      const ids = stamped.map((s) => {
        const cr = s.m ? this.st.claims.get(s.m.id) : undefined;
        const verdict = verdictOf(s.checks, s.cites, rec.meta.lock);
        if (cr) {
          core.setLiveCites(cr, s.cites);
          cr.fileCites = s.cites;
          cr.claim.checks = s.checks;
          cr.claim.verdict = verdict;
          delete cr.claim.verifiedBy;
          this.st.touchClaim(cr);
          return cr.claim.id;
        }
        const nc = core.addClaim(id, { kind: "fact", quote: "", cites: s.cites, verdict, checks: s.checks });
        core.db.putCites(nc.claim.id, id, s.cites);
        return nc.claim.id;
      });
      for (const d of dropped) this.st.claims.delete(d.id);
      core.db.dropCites(dropped.map((d) => d.id));
      rec.meta.claims = ids;
      core.setText(rec, marker);
      core.refreshQuotes(rec);
      core.history(rec, by, "human_edit");
      refreshDerived(core, [rec.meta.section]);
      core.schedule();
      const checks = stamped.flatMap((s, i) => {
        const at = `${id}#claim${i + 1}`;
        const where = s.cites.map((c) => `${c.path}:${c.start}-${c.end}`).join(",");
        const errs: { at: string; expected: string; actual: string; code: "E_INVALID_INPUT" }[] = [];
        if (!s.checks.l0) errs.push({ at, expected: "L0: the cited range exists", actual: where, code: "E_INVALID_INPUT" });
        if (s.checks.l1 === "fail")
          errs.push({ at, expected: "L1: the claim's identifiers appear in the cited range", actual: where, code: "E_INVALID_INPUT" });
        return errs;
      });
      if (dropped.length > 0) core.notice("info", "notice.doc.claimsDropped", { count: dropped.length });
      return { block: this.st.toBlock(rec), checks, dropped: dropped.map((d) => d.id) };
    });
  }

  setVerified(id: BlockId, verified: boolean, by: string): Block {
    const core = this.core;
    const rec = this.st.blocks.get(id);
    if (!rec) throw new MitoriError("E_NOT_FOUND", `no block ${id}`);
    if (verified) {
      rec.meta.lock = "human-verified";
      rec.meta.verifiedBy = by;
    } else {
      if (core.db.hasHumanEdit(id)) rec.meta.lock = "human-edited";
      else delete rec.meta.lock;
      delete rec.meta.verifiedBy;
    }
    const at = core.now();
    const updated: Claim[] = [];
    for (const c of this.st.claimsOf(rec)) {
      if (verified) c.claim.verifiedBy = { name: by, at };
      else delete c.claim.verifiedBy;
      c.claim.verdict = verdictOf(c.claim.checks, c.claim.cites, rec.meta.lock);
      this.st.touchClaim(c);
      updated.push(c.claim);
    }
    this.st.touchMeta(rec);
    if (updated.length > 0)
      core.deps.events.emit({ type: "doc.claims", claims: updated.map(({ id: cid, block, verdict, checks }) => ({ id: cid, block, verdict, checks })) });
    core.schedule();
    return this.st.toBlock(rec);
  }

  setFreshness(blocks: BlockId[], freshness: Block["freshness"]): void {
    const changed: BlockId[] = [];
    for (const id of blocks) {
      const r = this.st.blocks.get(id);
      if (!r || r.meta.freshness === freshness) continue;
      r.meta.freshness = freshness;
      this.st.touchMeta(r);
      changed.push(id);
    }
    if (changed.length === 0) return;
    this.core.deps.events.emit({ type: "doc.freshness", blocks: changed, freshness, paths: [] });
    this.core.schedule();
  }

  setClaimChecks(updates: Parameters<DocStore["setClaimChecks"]>[0]): void {
    const core = this.core;
    const now = core.deps.clock.now();
    const out: Claim[] = [];
    for (const u of updates) {
      const c = this.st.claims.get(u.id);
      const rec = c ? this.st.blocks.get(c.claim.block) : undefined;
      if (!c || !rec) continue;
      c.claim.checks = u.checks;
      if (u.cites) {
        core.setLiveCites(c, u.cites);
        this.st.touchCites(rec, now);
      }
      c.claim.verdict = u.verdict ?? verdictOf(u.checks, c.claim.cites, rec.meta.lock);
      this.st.touchClaim(c);
      out.push(c.claim);
    }
    if (out.length === 0) return;
    this.citing = null;
    core.deps.events.emit({ type: "doc.claims", claims: out.map(({ id, block, verdict, checks }) => ({ id, block, verdict, checks })) });
    core.schedule();
  }

  propose(p: Omit<DocProposal, "id" | "state" | "createdAt">): DocProposal {
    const id = propose(this.core, p);
    return this.core.db.proposal(id)?.p as DocProposal;
  }

  proposals(filter?: { state?: DocProposal["state"]; block?: BlockId }): DocProposal[] {
    return this.core.db.proposals(filter);
  }

  acceptProposal(id: ProposalId, md?: string): Block {
    const b = acceptProposal(this.core, id, md, (ids) => this.restamp(ids));
    refreshDerived(this.core, [b.section]);
    this.core.deps.events.emit({ type: "doc.proposal.removed", id });
    this.core.schedule();
    return b;
  }

  rejectProposal(id: ProposalId): void {
    const row = this.core.db.proposal(id);
    if (!row) throw new MitoriError("E_NOT_FOUND", `no proposal ${id}`);
    if (row.p.state !== "pending") return;
    this.core.db.setProposalState(id, "rejected");
    this.core.deps.events.emit({ type: "doc.proposal.removed", id });
  }

  undoAccept(proposals: ProposalId[]): { reverted: BlockId[]; diverged: BlockId[] } {
    const r = undoAccept(this.core, proposals, (ids) => this.restamp(ids));
    refreshDerived(this.core);
    this.core.schedule();
    return r;
  }

  history(block: BlockId) {
    return this.core.db.history(block);
  }

  textAt(block: BlockId, hash: string): string | null {
    return this.core.db.textAt(block, hash);
  }

  writeDecision(decision: Decision, md: string): Decision {
    const core = this.core;
    const bad = (why: string) => new MitoriError("E_INVALID_INPUT", `writeDecision: ${why}`, { params: { id: decision.id } });
    if (!/^dc_[0-9a-hjkmnp-tv-z]{8}$/.test(decision.id)) throw bad("id must be dc_<8>");
    if (decision.file !== `decisions/${decision.id}.md`) throw bad("file must be decisions/<id>.md");
    if (core.db.decisions().some((d) => d.id === decision.id)) throw bad("id already used");
    const first = md.split("\n", 1)[0] ?? "";
    if (!first.startsWith("# DC: ") || !new RegExp(`^- id: ${decision.id}$`, "m").test(md)) throw bad("Markdown needs a '# DC: ' title and a '- id:' line");
    const v = core.deps.secrets.scan(md);
    if (v.length > 0) throw new MitoriError("E_SECRET_DETECTED", "writeDecision: the decision text contains a secret", { params: { hits: v.length } });
    ensureManifest(core);
    core.db.putDecision(decision);
    this.decisionFiles.set(decision.file, md);
    this.flusher.extra.set(decision.file, md);
    if (decision.supersedes) {
      const old = core.db.decisions().find((d) => d.id === decision.supersedes);
      if (old) {
        core.db.putDecision({ ...old, status: "superseded" });
        const text = this.decisionFiles.get(old.file);
        if (text !== undefined) {
          const next = text.replace(/^- status: .*$/m, "- status: superseded");
          this.decisionFiles.set(old.file, next);
          this.flusher.extra.set(old.file, next);
        }
      }
    }
    refreshDerived(core);
    core.schedule();
    return decision;
  }

  decisions(): Decision[] {
    return this.core.db.decisions();
  }

  translation(block: BlockId, lang: DocLang) {
    const r = this.st.blocks.get(block);
    const t = this.core.db.translation(block, lang);
    return r && t && t.srcHash === r.meta.hash ? t : null;
  }

  putTranslation(rec: Parameters<DocStore["putTranslation"]>[0]): void {
    this.core.db.putTranslation(rec, this.core.now());
  }

  tombstone(ids: BlockId[]): void {
    const sections = ids.flatMap((id) => {
      const s = this.st.blocks.get(id)?.meta.section;
      return s ? [s] : [];
    });
    this.core.tombstone(ids);
    refreshDerived(this.core, sections);
    this.core.schedule();
  }

  flush(opts?: { force?: boolean }): Promise<string[]> {
    return this.flusher.flush(opts?.force === true);
  }
}

/** Build the store (deps per the contract + CR-PENDING optional ports). */
export function makeDocStore(deps: StoreDeps): DocStore & { settled(): Promise<void> } {
  return new Store(deps);
}

export { rawCite };
