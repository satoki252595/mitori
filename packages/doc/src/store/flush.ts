// flush (gen §10.9, ADR-0004 R1 §3–4): serialize changed files from fragment memos, then write them atomically
// through the SafeWriter (kind `doc`). A file whose bytes on disk differ from the ownership ledger is never
// overwritten: Markdown is left for load() to import (notice.doc.externalEdit), anything else gets
// notice.doc.notOwned. Cadence: 500 ms after a change, 2 s while generating; cite-only moves wait until the file
// is quiet ≥ 10 s (PT-11). Flushes never enter the write queue (callable inside or outside a slot); they are
// serialized by an internal chain.
import { canonicalJson, MitoriError } from "@mitori/core";
import { fragmentOf } from "../codec/parse.ts";
import type { BlockRec, StoreCore } from "./core.ts";
import { L } from "./i18n.ts";
import { allowedDocFile, resolveDocDir } from "./paths.ts";
import { IndexSerializer } from "./serialize.ts";

const CADENCE_MS = 500;
const GENERATING_CADENCE_MS = 2000;
const CITE_QUIET_MS = 10_000;
const GENERATING_WINDOW_MS = 2000;
/** Above this many UTF-16 units the ledger keeps no digest (hashing 18 MB costs ≈ 3 ms per flush, DOC-B-001). */
const LEDGER_DIGEST_MAX = 1 << 20;

interface Pending {
  rel: string;
  content: string;
  /** Model tick the content reflects. */
  tick: number;
  md: boolean;
  /** Applied after a successful write (claims' fileCites := live). */
  commit?: (() => void) | undefined;
  /** The producer knows whether the bytes equal the last write (skips an 18 MB compare); absent = compare. */
  same?: boolean;
}

export class Flusher {
  /** Content last written (or found identical on disk) per file. */
  readonly written = new Map<string, string>();
  readonly writtenTick = new Map<string, number>();
  private chain: Promise<string[]> = Promise.resolve([]);
  private timer: unknown = null;
  private timerAt = Number.POSITIVE_INFINITY;
  private readonly index = new IndexSerializer();
  private readonly frags = new Map<string, { tick: number; text: string }>();
  private noticed = new Set<string>();
  private lastIndex: string | null = null;
  /** Extra docDir files (decisions/…) waiting to be written. */
  readonly extra = new Map<string, string>();

  constructor(private readonly core: StoreCore) {
    core.orphanText = (sections) => this.fileText(sections);
  }

  /** Reserve a flush per the cadence. */
  schedule(): void {
    const timers = this.core.deps.timers === undefined ? defaultTimers : this.core.deps.timers;
    if (!timers) return;
    const now = this.core.deps.clock.now();
    const gen = now - this.core.lastGenAt < GENERATING_WINDOW_MS;
    let at = this.dirtyText() ? now + (gen ? GENERATING_CADENCE_MS : CADENCE_MS) : Number.POSITIVE_INFINITY;
    for (const t of this.core.st.citeMoved.values()) at = Math.min(at, t + CITE_QUIET_MS);
    if (at === Number.POSITIVE_INFINITY || at >= this.timerAt) return;
    if (this.timer !== null) timers.clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = timers.setTimeout(
      () => {
        this.timer = null;
        this.timerAt = Number.POSITIVE_INFINITY;
        this.flush(false).catch((e: unknown) => this.core.log.warn("auto flush failed", { error: e instanceof Error ? e.message : String(e) }));
      },
      Math.max(0, at - now),
    );
  }

  private dirtyText(): boolean {
    const st = this.core.st;
    if (
      st.indexTick > (this.writtenTick.get("doc.index.json") ?? -1) ||
      st.manifestTick > (this.writtenTick.get("mitori.json") ?? -1) ||
      this.extra.size > 0 ||
      this.core.orphans.size > 0
    )
      return true;
    for (const [rel, t] of st.fileTick) if (t > (this.writtenTick.get(rel) ?? -1)) return true;
    return false;
  }

  /** Run one flush after any in-flight one. */
  flush(force: boolean): Promise<string[]> {
    const run = this.chain.then(
      () => this.flushNow(force),
      () => this.flushNow(force),
    );
    this.chain = run.catch(() => []);
    return run;
  }

  /** One block's serialized fragment with live cites (memoized per text/cite tick). */
  fragmentOf(rec: BlockRec): string {
    const tick = rec.tick * 1e6 + rec.citeTick;
    let f = this.frags.get(rec.meta.id);
    if (!f || f.tick !== tick) {
      f = { tick, text: fragmentOf({ id: rec.meta.id, kind: rec.meta.kind, md: this.core.st.fileMd(rec, true) }, this.core.lang()) };
      this.frags.set(rec.meta.id, f);
    }
    return f.text;
  }

  /** One Markdown file's text from block fragment memos (live cites; claims' fileCites follow on commit). */
  private fileText(sections: ReturnType<StoreCore["st"]["files"]>[number]["sections"]): string {
    const parts = this.core.st.blocksOfFile(sections).map((rec) => this.fragmentOf(rec));
    return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
  }

  /** Collect what has to be written now (synchronous snapshot of the model). */
  private collect(force: boolean): { pending: Pending[]; remove: string[] } {
    const core = this.core;
    const st = core.st;
    const now = core.deps.clock.now();
    const generating = now - core.lastGenAt < GENERATING_WINDOW_MS;
    const pending: Pending[] = [];
    const live = new Set<string>();
    let citesCommitted = false;
    for (const { rel, sections } of st.files()) {
      live.add(rel);
      const tick = st.fileTick.get(rel) ?? 0;
      const moved = st.citeMoved.get(rel);
      const citeDue = moved !== undefined && (force || (now - moved >= CITE_QUIET_MS && !generating));
      const textDirty = tick > (this.writtenTick.get(rel) ?? -1);
      if (!textDirty && !citeDue) continue;
      if (st.blocksOfFile(sections).length === 0 && !this.written.has(rel)) continue;
      // cites moved but not yet due: write the file with the cites already on disk (fileCites) unless forced
      const useLive = citeDue || moved === undefined;
      const content = useLive ? this.fileText(sections) : this.fileTextFrozen(sections);
      const recs = st.blocksOfFile(sections);
      pending.push({
        rel,
        content,
        tick,
        md: true,
        commit: useLive
          ? () => {
              for (const r of recs)
                for (const c of st.claimsOf(r))
                  if (c.fileCites !== c.claim.cites) {
                    c.fileCites = c.claim.cites;
                    st.touchClaim(c);
                  }
              st.citeMoved.delete(rel);
            }
          : undefined,
      });
      if (useLive) citesCommitted = true;
    }
    // the sidecar carries the cites as written: commit them before serializing it
    for (const p of pending) p.commit?.();
    for (const p of pending) delete p.commit;
    const removes = [...this.written.keys()].filter((rel) => rel.endsWith(".md") && rel.startsWith("doc/") && !live.has(rel));
    if (st.indexTick > (this.writtenTick.get("doc.index.json") ?? -1) || citesCommitted) {
      const ix = this.index.serialize(st, core.readingPaths());
      // "unchanged" is trusted only when the previous serialization is what was written (same string object)
      const prev = this.lastIndex;
      this.lastIndex = ix.text;
      const trusted = prev !== null && this.written.get("doc.index.json") === prev;
      pending.push({ rel: "doc.index.json", content: ix.text, tick: st.indexTick, md: false, ...(trusted ? { same: !ix.changed } : {}) });
    }
    if (st.manifest && st.manifestTick > (this.writtenTick.get("mitori.json") ?? -1)) {
      pending.push({ rel: "mitori.json", content: canonicalJson(st.manifest), tick: st.manifestTick, md: false });
    }
    if (st.manifest) {
      const lang = core.lang();
      if (!this.written.has("README.md")) pending.push({ rel: "README.md", content: L[lang].readme, tick: 0, md: false });
      const ignore = core.deps.ws.docCommitted ? "cache/\ntmp/\n" : "*\n";
      // written FIRST: until it exists the whole docDir shows as untracked (`?? .mitori/`) in the user's `git status`
      if (this.written.get(".gitignore") !== ignore) pending.unshift({ rel: ".gitignore", content: ignore, tick: 0, md: false });
    }
    for (const [rel, content] of this.extra) pending.push({ rel, content, tick: 0, md: true });
    for (const [rel, content] of core.orphans) pending.push({ rel, content, tick: 0, md: true });
    return { pending, remove: removes };
  }

  /** File text with the cites as currently on disk (cite moves deferred). */
  private fileTextFrozen(sections: ReturnType<StoreCore["st"]["files"]>[number]["sections"]): string {
    const st = this.core.st;
    const lang = this.core.lang();
    const parts = st.blocksOfFile(sections).map((rec) => fragmentOf({ id: rec.meta.id, kind: rec.meta.kind, md: st.fileMd(rec, false) }, lang));
    return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
  }

  private async flushNow(force: boolean): Promise<string[]> {
    const core = this.core;
    const t0 = performance.now();
    if (!core.docDir) {
      try {
        core.docDir = resolveDocDir(core.deps.ws, core.deps.fs);
      } catch (e) {
        core.docDirError = e as Error;
        throw e;
      }
    }
    const { pending, remove } = this.collect(force);
    const root = core.docDir.rootReal;
    const out: string[] = [];
    let bytes = 0;
    for (const p of pending) {
      if (p.same ?? this.written.get(p.rel) === p.content) {
        this.markWritten(p);
        continue;
      }
      if (!allowedDocFile(p.rel)) throw new MitoriError("E_PATH_OUTSIDE", `refusing to write ${p.rel}`);
      const own = await this.ownership(root, p.rel, p.content);
      if (own === "same") {
        this.markWritten(p);
        continue;
      }
      if (own === "foreign") {
        this.noticeOnce(p.rel, p.md ? "notice.doc.externalEdit" : "notice.doc.notOwned");
        if (p.rel === "README.md" || p.rel === ".gitignore") this.written.set(p.rel, p.content);
        continue;
      }
      await core.deps.safeWrite.write(root, p.rel, p.content, "doc");
      bytes += p.content.length;
      this.recordLedger(root, p.rel, p.content);
      this.markWritten(p);
      out.push(p.rel);
    }
    for (const rel of remove) {
      const own = await this.ownership(root, rel, null);
      if (own === "ok") await core.deps.safeWrite.remove(root, rel, "doc");
      this.written.delete(rel);
      this.writtenTick.delete(rel);
      out.push(rel);
    }
    if (out.length > 0) core.deps.events.emit({ type: "doc.saved", files: out });
    core.deps.metrics.observe("doc.flush.ms", performance.now() - t0);
    if (bytes > 0) core.deps.metrics.inc("doc.flush.bytes", bytes);
    this.schedule();
    return out;
  }

  private markWritten(p: Pending): void {
    this.written.set(p.rel, p.content);
    if (p.tick > (this.writtenTick.get(p.rel) ?? -1)) this.writtenTick.set(p.rel, p.tick);
    if (this.extra.get(p.rel) === p.content) this.extra.delete(p.rel);
    if (this.core.orphans.get(p.rel) === p.content) this.core.orphans.delete(p.rel);
    this.noticed.delete(p.rel);
  }

  private noticeOnce(rel: string, key: string): void {
    if (this.noticed.has(rel)) return;
    this.noticed.add(rel);
    this.core.notice("warn", key, { file: rel });
  }

  /** Ownership of a docDir file: `ok` (ours or absent), `same` (already these bytes), `foreign` (do not touch). */
  private async ownership(root: string, rel: string, content: string | null): Promise<"ok" | "same" | "foreign"> {
    const fs = this.core.deps.fs;
    if (!fs) return "ok";
    const abs = `${root}/${rel}`;
    const st = fs.stat(abs);
    if (!st) return "ok";
    if (st.isSymlink || !st.isFile) return "foreign";
    const led = this.core.db.ledger(rel);
    const { hasher } = this.core.deps;
    if (led && led.size === st.size && led.mtimeNs === String(st.mtimeNs)) {
      // untouched since our last write: identical bytes need no rewrite (README / .gitignore are not re-read by load)
      if (content !== null && led.digest !== "" && content.length <= LEDGER_DIGEST_MAX && led.digest === hasher.xxh3(content)) return "same";
      return "ok";
    }
    const text = new TextDecoder().decode(await fs.read(abs));
    if (content !== null && text === content) {
      this.core.db.setLedger(rel, text.length <= LEDGER_DIGEST_MAX ? hasher.xxh3(text) : "", st.size, st.mtimeNs);
      return "same";
    }
    if (led && led.digest !== "" && led.digest === hasher.xxh3(text)) return "ok";
    // the bytes are exactly what this store last wrote or imported (a touch / checkout changed only the stat;
    // large files keep no digest, so this is how they are recognized)
    if (this.written.get(rel) === text) return "ok";
    return "foreign";
  }

  /**
   * Ledger row after a write. The digest is xxh3 (equality is all the ledger needs; sha256 of a 10k-block sidecar
   * alone costs the whole DOC-B-001 budget). Size + mtime let the next check skip reading the file.
   */
  recordLedger(root: string, rel: string, content: string): void {
    const fs = this.core.deps.fs;
    const st = fs?.stat(`${root}/${rel}`);
    // large files (the sidecar of a big doc) keep size + mtime only: a later mismatch is then treated as foreign,
    // which for Markdown / the sidecar means "import on the next load" — never an overwrite
    const digest = content.length <= LEDGER_DIGEST_MAX ? this.core.deps.hasher.xxh3(content) : "";
    this.core.db.setLedger(rel, digest, st?.size ?? content.length, st?.mtimeNs ?? 0n);
  }

  /** After load(): the bytes on disk are what we hold (ledger adopts imported files). */
  adopt(rel: string, text: string, tick: number): void {
    this.written.set(rel, text);
    this.writtenTick.set(rel, tick);
    const root = this.core.docDir?.rootReal;
    if (root) this.recordLedger(root, rel, text);
  }
}

const defaultTimers = {
  setTimeout(fn: () => void, ms: number): unknown {
    const t = setTimeout(fn, ms) as unknown as { unref?: () => void };
    t.unref?.();
    return t;
  },
  clearTimeout(id: unknown): void {
    clearTimeout(id as ReturnType<typeof setTimeout>);
  },
};
