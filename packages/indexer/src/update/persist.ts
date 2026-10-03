// SQLite persistence of the S0/S1 state (indexer spec §9, IDX-D7): written through the write queue after `scan.done`
// in ≤ 2,000-file transactions; only rows that changed since the last write are touched (a warm no-change scan writes
// nothing). Reads are direct (`SqlDb` is synchronous).
import type { ExtractorVersion, RepoPath, SourceLang } from "@mitori/core";
import type { FactCandidate, FileScope, GrammarId, ImportRecord, InventoryRuleId, RefRecord, SkeletonTier } from "../contract.ts";
import type { SkeletonBodies } from "../skeleton/render.ts";
import { estimateTokensRaw } from "../tokens/index.ts";
import type { Core } from "./core.ts";
import { contentKey, type FileRec, type Parsed, type StoredSymbol } from "./model.ts";

const CHUNK = 2_000;
const TIERS: readonly SkeletonTier[] = ["l0", "sig", "doc"];

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (v: unknown): Uint8Array => enc.encode(JSON.stringify(v));
const unjson = <T>(b: Uint8Array | string | null, fallback: T): T => {
  if (b === null) return fallback;
  return JSON.parse(typeof b === "string" ? b : dec.decode(b)) as T;
};

function rowSig(r: FileRec): string {
  return [
    r.raw,
    r.blob,
    r.mode,
    r.size,
    r.mtimeNs,
    r.ino,
    r.racy,
    r.tracked,
    r.dirty,
    r.lang,
    r.grammar,
    r.dialect,
    r.class,
    r.excluded,
    r.scope,
    r.rule,
    r.extractor,
    r.note,
  ].join("\0");
}

interface FileRow {
  path: string;
  raw: string | null;
  blob: string;
  mode: number;
  size: number;
  mtime_ns: number | bigint;
  ino: number | bigint | null;
  racy: number;
  tracked: number;
  dirty: number;
  lang: string;
  grammar: string | null;
  dialect: string | null;
  class: string;
  excluded: string | null;
  excluded_ext: string | null;
  scope: string;
  rule: string;
  extractor: string | null;
  note: string | null;
  seen: number;
}

/** Load idx_files rows as the previous state (daemon restart: the stat cache and blob cache survive). */
export function loadFiles(core: Core): Map<RepoPath, FileRec> {
  const out = new Map<RepoPath, FileRec>();
  core.settingsKey = core.deps.db.get<{ v: string }>(`SELECT v FROM idx_meta WHERE k = 'settings_key'`)?.v ?? null;
  core.dbSettingsKey = core.settingsKey;
  core.dbDigest = core.deps.db.get<{ v: string }>(`SELECT v FROM idx_meta WHERE k = 'last_snapshot'`)?.v ?? null;
  for (const row of core.deps.db.all<FileRow>(`SELECT * FROM idx_files`)) {
    const r: FileRec = {
      path: row.path,
      raw: row.raw ?? row.path,
      blob: row.blob,
      indexBlob: "",
      mode: row.mode.toString(8).padStart(6, "0"),
      size: row.size,
      mtimeNs: BigInt(row.mtime_ns),
      ino: BigInt(row.ino ?? 0),
      racy: row.racy === 1,
      tracked: row.tracked === 1,
      dirty: row.dirty === 1,
      lang: row.lang as SourceLang,
      grammar: row.grammar as GrammarId | null,
      dialect: row.dialect,
      class: row.class as FileRec["class"],
      scope: row.scope as FileScope,
      rule: row.rule as InventoryRuleId,
      attrs: {},
      include: false,
      lines: 0,
      loc: 0,
      chars: 0,
      cjk: 0,
      tokensEst: 0,
      seen: row.seen,
    };
    if (row.excluded_ext !== null) r.excluded = row.excluded_ext as NonNullable<FileRec["excluded"]>;
    else if (row.excluded !== null) r.excluded = row.excluded as NonNullable<FileRec["excluded"]>;
    if (row.extractor !== null) r.extractor = row.extractor as ExtractorVersion;
    if (row.note !== null) r.note = row.note as NonNullable<FileRec["note"]>;
    out.set(r.path, r);
    core.dbFiles.set(r.path, rowSig(r));
    if (r.seen > core.gen) core.gen = r.seen;
  }
  return out;
}

interface BlobRow {
  blob: string;
  extractor: string;
  bytes: number;
  lines: number;
  loc: number;
  cjk: number;
  chars: number;
  content_class: string | null;
  errors: number;
  imports: Uint8Array | null;
  refs: Uint8Array | null;
  tests: Uint8Array | null;
  lang: string | null;
  grammar: string | null;
  note: string | null;
  data: Uint8Array | null;
}

interface SymRow {
  ord: number;
  qualname: string;
  name: string;
  kind: string;
  start: number;
  end: number;
  body_start: number | null;
  body_end: number | null;
  doc_start: number | null;
  doc_end: number | null;
  signature: string;
  doc: string | null;
  sig_hash: string;
  body_hash: string;
  exported: number;
  parent_ord: number | null;
  complexity: number;
  decorators: string | null;
}

interface BlobData {
  extractor: ExtractorVersion | null;
  contentRule?: InventoryRuleId;
  headings?: { level: number; line: number; text: string }[];
  rationale: { start: number; end: number }[];
  facts: FactCandidate[];
}

/** Read one S1 result back from SQLite (cache hit after a restart), registering it in memory. */
export function loadParsed(core: Core, blob: string, key: string): Parsed | null {
  const db = core.deps.db;
  const row = db.get<BlobRow>(`SELECT * FROM idx_blobs WHERE blob = ? AND extractor = ?`, [blob, key]);
  if (row === null) return null;
  const data = unjson<BlobData>(row.data, { extractor: null, rationale: [], facts: [] });
  const symbols: StoredSymbol[] = db.all<SymRow>(`SELECT * FROM idx_symbols WHERE blob = ? AND extractor = ? ORDER BY ord`, [blob, key]).map((s) => {
    const o: StoredSymbol = {
      ord: s.ord,
      kind: s.kind as StoredSymbol["kind"],
      name: s.name,
      qualname: s.qualname,
      start: s.start,
      end: s.end,
      signature: s.signature,
      sigHash: s.sig_hash,
      bodyHash: s.body_hash,
      exported: s.exported === 1,
      complexity: s.complexity,
    };
    if (s.body_start !== null) o.bodyStart = s.body_start;
    if (s.body_end !== null) o.bodyEnd = s.body_end;
    if (s.doc_start !== null) o.docStart = s.doc_start;
    if (s.doc_end !== null) o.docEnd = s.doc_end;
    if (s.doc !== null) o.doc = s.doc;
    if (s.parent_ord !== null) o.parentOrd = s.parent_ord;
    if (s.decorators !== null) o.decorators = JSON.parse(s.decorators) as string[];
    return o;
  });
  const p: Parsed = {
    blob,
    key,
    extractor: data.extractor,
    lang: (row.lang ?? "generic") as SourceLang,
    grammar: row.grammar as GrammarId | null,
    bytes: row.bytes,
    lines: row.lines,
    loc: row.loc,
    cjk: row.cjk,
    chars: row.chars,
    errors: row.errors,
    symbols,
    imports: unjson<ImportRecord[]>(row.imports, []),
    refs: unjson<RefRecord[]>(row.refs, []),
    tests: unjson<{ name: string; line: number }[]>(row.tests, []),
    facts: data.facts,
    rationale: data.rationale,
    skeleton: null,
    dirtyDb: false,
  };
  if (row.content_class !== null) p.contentClass = row.content_class as NonNullable<Parsed["contentClass"]>;
  if (data.contentRule !== undefined) p.contentRule = data.contentRule;
  if (data.headings !== undefined) p.headings = data.headings;
  if (row.note !== null) p.note = row.note as NonNullable<Parsed["note"]>;
  core.parsed.set(contentKey(blob, key), p);
  return p;
}

/** Skeleton fragment body from SQLite (after the in-memory copy was evicted). */
export function loadSkeleton(core: Core, blob: string, key: string, tier: SkeletonTier): string | null {
  return core.deps.db.get<{ text: string }>(`SELECT text FROM idx_skeleton WHERE blob = ? AND extractor = ? AND tier = ?`, [blob, key, tier])?.text ?? null;
}

function writeParsed(core: Core, p: Parsed, nowS: number): void {
  const db = core.deps.db;
  const data: BlobData = { extractor: p.extractor, rationale: p.rationale, facts: p.facts };
  if (p.contentRule !== undefined) data.contentRule = p.contentRule;
  if (p.headings !== undefined) data.headings = p.headings;
  const sigDigest = core.xxh3(p.symbols.map((s) => s.sigHash).join(""));
  const bodyDigest = core.xxh3(p.symbols.map((s) => s.bodyHash).join(""));
  db.run(
    `INSERT OR REPLACE INTO idx_blobs (blob, extractor, bytes, lines, loc, cjk, chars, content_class, errors, parse_ms, sig_digest, body_digest, imports, refs, tests, lang, grammar, note, data, last_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.blob,
      p.key,
      p.bytes,
      p.lines,
      p.loc,
      p.cjk,
      p.chars,
      p.contentClass ?? null,
      p.errors,
      sigDigest,
      bodyDigest,
      json(p.imports),
      json(p.refs),
      json(p.tests),
      p.lang,
      p.grammar,
      p.note ?? null,
      json(data),
      nowS,
    ],
  );
  db.run(`DELETE FROM idx_symbols WHERE blob = ? AND extractor = ?`, [p.blob, p.key]);
  for (const s of p.symbols) {
    db.run(
      `INSERT INTO idx_symbols (blob, extractor, ord, qualname, name, kind, start, "end", body_start, body_end, doc_start, doc_end, signature, doc, sig_hash, body_hash, exported, parent_ord, complexity, decorators)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.blob,
        p.key,
        s.ord,
        s.qualname,
        s.name,
        s.kind,
        s.start,
        s.end,
        s.bodyStart ?? null,
        s.bodyEnd ?? null,
        s.docStart ?? null,
        s.docEnd ?? null,
        s.signature,
        s.doc ?? null,
        s.sigHash,
        s.bodyHash,
        s.exported ? 1 : 0,
        s.parentOrd ?? null,
        s.complexity,
        s.decorators === undefined ? null : JSON.stringify(s.decorators),
      ],
    );
  }
  const sk = p.skeleton;
  if (sk !== undefined && sk !== null) {
    for (const t of TIERS) {
      const text = (sk as SkeletonBodies)[t];
      db.run(`INSERT OR REPLACE INTO idx_skeleton (blob, extractor, tier, text, tok_v5, tok_v4) VALUES (?, ?, ?, ?, ?, ?)`, [
        p.blob,
        p.key,
        t,
        text,
        estimateTokensRaw(text, "code", "claude-v5"),
        estimateTokensRaw(text, "code", "claude-v4"),
      ]);
    }
    p.skeleton = null; // evicted: served from idx_skeleton from now on
  }
  p.dirtyDb = false;
}

function writeFile(core: Core, r: FileRec): void {
  const ext = r.excluded === "special" || r.excluded === "fixture" ? r.excluded : null;
  core.deps.db.run(
    `INSERT OR REPLACE INTO idx_files (path, raw, blob, mode, size, mtime_ns, ino, racy, tracked, dirty, lang, grammar, dialect, class, excluded, excluded_ext, scope, rule, extractor, module, note, seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      r.path,
      r.raw === r.path ? null : r.raw,
      r.blob,
      Number.parseInt(r.mode, 8),
      r.size,
      r.mtimeNs,
      r.ino,
      r.racy ? 1 : 0,
      r.tracked ? 1 : 0,
      r.dirty ? 1 : 0,
      r.lang,
      r.grammar,
      r.dialect,
      r.class,
      r.excluded ?? null,
      ext,
      r.scope,
      r.rule,
      r.extractor ?? null,
      r.note ?? null,
      r.seen,
    ],
  );
}

/** Persist everything that changed since the last write (background after `scan.done`; `single` = one transaction). */
export async function persist(core: Core, opts: { snapshotRow?: { packKey: string; ms: number; timings: string }; single?: boolean } = {}): Promise<number> {
  const { db, write, metrics } = core.deps;
  const nowS = Math.floor(core.deps.clock.now() / 1000);
  const changedFiles: FileRec[] = [];
  for (const r of core.files.values()) {
    const sig = rowSig(r);
    if (core.dbFiles.get(r.path) !== sig) changedFiles.push(r);
  }
  const removed: RepoPath[] = [];
  for (const p of core.dbFiles.keys()) if (!core.files.has(p)) removed.push(p);
  const dirtyParsed = [...core.parsed.values()].filter((p) => p.dirtyDb);
  const settingsChanged = core.settingsKey !== null && core.dbSettingsKey !== core.settingsKey;
  const snap = core.snap;
  const snapRow = opts.snapshotRow;
  const snapChanged = snap !== null && snap.indexDigest !== core.dbDigest && snapRow !== undefined;
  if (changedFiles.length === 0 && removed.length === 0 && dirtyParsed.length === 0 && !settingsChanged && !snapChanged) return 0;

  const steps: (() => void)[] = [];
  for (let i = 0; i < dirtyParsed.length; i += CHUNK) {
    const part = dirtyParsed.slice(i, i + CHUNK);
    steps.push(() => {
      for (const p of part) writeParsed(core, p, nowS);
    });
  }
  for (let i = 0; i < changedFiles.length; i += CHUNK) {
    const part = changedFiles.slice(i, i + CHUNK);
    steps.push(() => {
      for (const r of part) {
        writeFile(core, r);
        core.dbFiles.set(r.path, rowSig(r));
      }
    });
  }
  if (removed.length > 0 || settingsChanged || snapChanged) {
    steps.push(() => {
      for (const p of removed) {
        db.run(`DELETE FROM idx_files WHERE path = ?`, [p]);
        core.dbFiles.delete(p);
      }
      if (core.settingsKey !== null) {
        db.run(`INSERT OR REPLACE INTO idx_meta (k, v) VALUES ('settings_key', ?)`, [core.settingsKey]);
        core.dbSettingsKey = core.settingsKey;
      }
      if (snapChanged && snap !== null && snapRow !== undefined) {
        let files = 0;
        let loc = 0;
        for (const r of core.files.values())
          if (r.excluded === undefined) {
            files++;
            loc += r.loc;
          }
        db.run(
          `INSERT INTO idx_snapshots ("commit", tree, branch, dirty, index_digest, pack_key, taken_at, files, loc, ms, timings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            snap.commit,
            snap.tree,
            snap.branch,
            snap.dirty ? 1 : 0,
            snap.indexDigest,
            snapRow.packKey,
            snap.takenAt,
            files,
            loc,
            Math.round(snapRow.ms),
            snapRow.timings,
          ],
        );
        db.run(`INSERT OR REPLACE INTO idx_meta (k, v) VALUES ('last_snapshot', ?)`, [snap.indexDigest]);
        core.dbDigest = snap.indexDigest;
      }
    });
  }
  const groups = opts.single === true ? [steps] : steps.map((s) => [s]);
  for (const g of groups) {
    await write("idx.persist", () => {
      db.tx(() => {
        for (const s of g) s();
      });
      metrics.inc("idx.sql.writes");
    });
  }
  return groups.length;
}
