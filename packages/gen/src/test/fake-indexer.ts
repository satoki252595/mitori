/**
 * Hand-built `Indexer` over a {@link FakeRepo} (testkit `indexerFromGolden` is still a stub). Implements the
 * read surface gen uses; everything else throws E_UNSUPPORTED. `setFile` edits a file (new blob, new digest;
 * the old blob text stays readable) to exercise PT-05.
 */
import {
  type CodeSlice,
  type Fact,
  type FileEntry,
  type GitOid,
  type Hasher,
  type LineNo,
  type ModuleId,
  type ModuleInfo,
  type RepoPath,
  type RepoSnapshot,
  type SymbolEntry,
  unsupported,
} from "@mitori/core";
import type { FlowSeed, Indexer, ModuleContext, ModuleDetail, ModuleStats, RepoPack, Skeleton, SkeletonTarget, SkeletonTier } from "@mitori/indexer";
import type { FakeRepo } from "./repo.ts";

/** Fake indexer handle. */
export interface FakeIndexer extends Indexer {
  /** Replace a file's text (new blob). */
  setFile(path: RepoPath, text: string): void;
  /** Blobs pinned via `pinBlobs`. */
  pinned: Set<GitOid>;
  /** Number of `repoPack` calls. */
  packCalls: number;
}

const tokens = (text: string) => Math.ceil(text.length / 2.3);

/** Factory. */
export function createFakeIndexer(repo: FakeRepo, hasher: Hasher): FakeIndexer {
  const texts = new Map<RepoPath, string>(Object.entries(repo.files));
  const blobs = new Map<GitOid, string>();
  const blobOf = new Map<RepoPath, GitOid>();
  const pinned = new Set<GitOid>();
  let digest = "";
  const refresh = () => {
    for (const [p, t] of texts) {
      const b = hasher.gitBlob(new TextEncoder().encode(t), "sha1");
      blobOf.set(p, b);
      blobs.set(b, t);
    }
    digest = hasher.xxh3(
      [...blobOf]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([p, b]) => `${p}\0${b}`)
        .join("\n"),
    );
  };
  refresh();
  const lineArr = (t: string) => t.replace(/\n$/, "").split("\n");
  const modules: ModuleInfo[] = repo.modules.map((m) => {
    const info: ModuleInfo = {
      id: m.id,
      slug: m.slug,
      name: m.name,
      children: m.children,
      paths: m.paths,
      loc: m.paths.reduce((n, p) => n + lineArr(texts.get(p) ?? "").length, 0),
      rank: m.rank,
      membersDigest: hasher.xxh3(m.paths.join(",")),
      ifaceDigest: hasher.xxh3(`if:${m.id}`),
      crossCutting: false,
      topoOrder: m.topoOrder,
    };
    if (m.parent) info.parent = m.parent;
    return info;
  });
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const leafPaths = (id: ModuleId): RepoPath[] => {
    const m = moduleById.get(id);
    if (!m) return [];
    return m.children.length === 0 ? m.paths : m.children.flatMap(leafPaths);
  };
  const symbolEntries = (path: RepoPath): SymbolEntry[] =>
    (repo.symbols[path] ?? []).map((s) => {
      const line = lineArr(texts.get(path) ?? "")[s.start - 1] ?? "";
      return {
        key: `${path}#${s.qualname}`,
        path,
        blob: blobOf.get(path) ?? "",
        kind: s.kind,
        name: s.name,
        qualname: s.qualname,
        start: s.start,
        end: s.end,
        signature: line.trim(),
        sigHash: hasher.xxh3(line.trim()),
        bodyHash: hasher.xxh3(`${path}:${s.start}`),
        exported: s.exported,
      };
    });
  const file = (path: RepoPath): FileEntry | null => {
    const t = texts.get(path);
    if (t === undefined) return null;
    const n = lineArr(t).length;
    const entry: FileEntry = {
      path,
      blob: blobOf.get(path) as GitOid,
      size: t.length,
      lang: path.endsWith(".ts") ? "typescript" : "generic",
      class: path.endsWith(".md") ? "docs" : "source",
      lines: n,
      loc: n,
      tokensEst: tokens(t),
    };
    const owner = repo.modules.find((m) => m.paths.includes(path));
    if (owner) entry.module = owner.id;
    const excluded = repo.excluded?.[path];
    if (excluded) entry.excluded = excluded;
    return entry;
  };
  const numbered = (path: RepoPath, keep: (line: number) => boolean): string => {
    const out = [`=== ${path}`];
    let gap = false;
    lineArr(texts.get(path) ?? "").forEach((l, i) => {
      if (keep(i + 1)) {
        out.push(`${i + 1}|${l}`);
        gap = false;
      } else if (!gap) {
        out.push("⋮");
        gap = true;
      }
    });
    return out.join("\n");
  };
  const skeletonOf = (paths: RepoPath[], tier: SkeletonTier, key: string): Skeleton => {
    const parts = paths.map((p) => {
      if (tier !== "sig") return numbered(p, () => true);
      const starts = new Set((repo.symbols[p] ?? []).map((s) => s.start));
      return numbered(p, (n) => starts.has(n));
    });
    const text = parts.join("\n");
    return {
      tier,
      text,
      tokens: tokens(text),
      files: paths,
      omitted: [],
      perFile: paths.map((p, i) => ({ path: p, tokens: tokens(parts[i] ?? ""), folded: false })),
      redactions: 0,
      key: hasher.xxh3(`${key}:${tier}:${digest}`),
    };
  };
  const factsWithBlob = (): Fact[] => repo.facts.map((f) => ({ ...f, blob: blobOf.get(f.path) ?? "" }) as Fact);
  const slice = (path: RepoPath, start: LineNo, end: LineNo, blob?: GitOid): CodeSlice => {
    const all = lineArr((blob ? blobs.get(blob) : texts.get(path)) ?? "");
    const s = Math.max(1, start);
    const e = Math.min(all.length, end);
    const text = all
      .slice(s - 1, e)
      .map((l, i) => `${s + i}|${l}`)
      .join("\n");
    return { path, blob: blob ?? (blobOf.get(path) as GitOid), start: s, end: e, text, numbered: true, tokens: tokens(text), redactions: 0 };
  };
  const no =
    (name: string) =>
    (...args: unknown[]): never =>
      unsupported(`fakeIndexer.${name}`, ...args);

  const ix: FakeIndexer = {
    pinned,
    packCalls: 0,
    setFile(path, text) {
      texts.set(path, text);
      refresh();
    },
    scan: no("scan"),
    update: no("update"),
    setActive: () => undefined,
    snapshot: (): RepoSnapshot => ({ commit: null, tree: null, branch: "main", dirty: false, indexDigest: digest, takenAt: "2026-10-03T00:00:00.000Z" }),
    lastTimings: () => null,
    files: () => [...texts.keys()].sort().map((p) => file(p) as FileEntry),
    file,
    fileDetail: no("fileDetail"),
    explain: no("explain"),
    currentBlob: (path) => blobOf.get(path) ?? null,
    read: async (path, range, opts) => {
      const n = lineArr(texts.get(path) ?? "").length;
      return slice(path, range?.start ?? 1, range?.end ?? n, opts?.blob);
    },
    blobText: async (blob) => blobs.get(blob) ?? null,
    pinBlobs: async (b) => {
      for (const x of b) pinned.add(x);
    },
    unpinBlobs: async (b) => {
      for (const x of b) pinned.delete(x);
    },
    currentText: async (path) => texts.get(path) ?? null,
    renamedTo: () => null,
    symbols: symbolEntries,
    symbolDetails: no("symbolDetails"),
    symbolsAt: async (path) => symbolEntries(path),
    enclosingSymbol: (path, start, end) => {
      let best: SymbolEntry | null = null;
      for (const s of symbolEntries(path)) if (s.start <= start && s.end >= end && (!best || s.end - s.start <= best.end - best.start)) best = s;
      return best;
    },
    symbol: (key) => {
      const path = key.slice(0, key.indexOf("#"));
      return symbolEntries(path).find((s) => s.key === key) ?? null;
    },
    symbolRange: no("symbolRange"),
    findSymbols: no("findSymbols"),
    imports: no("imports"),
    dependents: no("dependents"),
    modules: () => modules,
    module: (id) => moduleById.get(id) ?? null,
    moduleDetail: (id): ModuleDetail | null => {
      const m = moduleById.get(id);
      if (!m) return null;
      const paths = leafPaths(id);
      const dir = paths[0]?.split("/").slice(0, -1).join("/") ?? ".";
      return {
        ...m,
        alive: true,
        depth: m.parent ? 2 : 1,
        dominantDir: dir,
        anchor: paths[0] ?? "",
        bodyDigest: "0",
        factsDigest: "0",
        testsDigest: "0",
        tests: [],
        oversizeFile: false,
        reps: paths,
        bornAt: "2026-10-01T00:00:00.000Z",
      };
    },
    moduleOf: (path) => repo.modules.find((m) => m.paths.includes(path))?.id ?? null,
    structure: () => null,
    graph: () => ({
      level: "module",
      nodes: modules.map((m) => ({ id: m.id, label: m.name, module: m.id, rank: m.rank, loc: m.loc })),
      edges: repo.modules.flatMap((m) => m.deps.map((d) => ({ from: m.id, to: d.module, kind: "import" as const, weight: d.weight }))),
    }),
    facts: (kind) => factsWithBlob().filter((f) => kind === undefined || f.kind === kind),
    configs: () => [],
    tests: () => [],
    skeleton: (target: SkeletonTarget, tier: SkeletonTier) => {
      if (target.kind === "module") return skeletonOf(leafPaths(target.module), tier, target.module);
      if (target.kind === "file") return skeletonOf([target.path], tier, target.path);
      return skeletonOf([...texts.keys()].sort(), "l0", "repo");
    },
    hotBodies: () => [],
    moduleContext: (id, opts): ModuleContext => {
      const m = moduleById.get(id);
      if (!m) throw new Error(`no module ${id}`);
      const sk = skeletonOf(leafPaths(id), opts.tier ?? "sig", id);
      const hot: CodeSlice[] = [];
      for (const p of m.paths) {
        const fn = (repo.symbols[p] ?? []).find((s) => s.kind === "method" || s.kind === "function");
        if (fn) hot.push(slice(p, fn.start, fn.end));
      }
      const facts = factsWithBlob()
        .filter((f) => m.paths.includes(f.path))
        .map((f) =>
          f.kind === "route" ? `> R ${f.method} ${f.pattern} ${f.path}:${f.line} h=${f.handler ?? "-"} fw=${f.framework}` : `> E ${f.kind} ${f.path}:${f.line}`,
        )
        .join("\n");
      const hotTokens = hot.reduce((n, h) => n + h.tokens, 0);
      return {
        module: m,
        skeleton: sk,
        hot,
        tests: "",
        facts,
        neighbors: "",
        tokens: { skeleton: sk.tokens, hot: hotTokens, tests: 0, facts: tokens(facts), neighbors: 0, total: sk.tokens + hotTokens + tokens(facts) },
        key: hasher.xxh3(`ctx:${id}:${digest}`),
      };
    },
    repoPack: (): RepoPack => {
      ix.packCalls++;
      const modLines = modules.map((m) => `> ${m.id} ${m.slug} files=${m.paths.length} rank=${m.rank.toFixed(2)}`);
      const fl = factsWithBlob().map((f) => `> ${f.kind === "route" ? `R ${f.method} ${f.pattern}` : f.kind} ${f.path}:${f.line}`);
      const fileList = [...texts.keys()].sort().map((p) => `> F ${p} lines=${lineArr(texts.get(p) ?? "").length}`);
      const text = ["# mitori.repopack/1", "=== MODULES", ...modLines, "=== FACTS", ...fl, "=== FILES", ...fileList].join("\n");
      return { text, tokens: tokens(text), indexDigest: digest, key: hasher.xxh3(`pack:${text}`), parts: [], redactions: 0 };
    },
    moduleSeeds: () => [],
    moduleStats: (id): ModuleStats | null => {
      const m = repo.modules.find((x) => x.id === id);
      if (!m) return null;
      const paths = leafPaths(id);
      const syms = paths.flatMap((p) => repo.symbols[p] ?? []);
      return {
        module: id,
        files: paths.length,
        loc: paths.reduce((n, p) => n + lineArr(texts.get(p) ?? "").length, 0),
        symbols: syms.length,
        exportedSymbols: syms.filter((s) => s.exported).length,
        tests: 0,
        testFiles: 0,
        facts: {},
        depsOut: m.deps,
        depsIn: repo.modules.flatMap((x) => x.deps.filter((d) => d.module === id).map((d) => ({ module: x.id, weight: d.weight }))),
      };
    },
    flowSeeds: (limit = 8): FlowSeed[] =>
      factsWithBlob()
        .filter((f) => f.kind === "route" || f.kind === "entry")
        .slice(0, limit)
        .map((f, i) => ({
          k: i + 1,
          kind: f.kind === "route" ? "route" : "entry",
          label: f.kind === "route" ? `${f.method} ${f.pattern}` : f.path,
          path: f.path,
          line: f.line,
          modules: f.kind === "route" ? ["md_a0000003", "md_a0000002", "md_a0000001"] : ["md_a0000004", "md_a0000003"],
          files: [f.path],
        })),
    flowBodies: (seed) => {
      const fn = (repo.symbols[seed.path] ?? []).find((s) => s.start <= seed.line && s.end >= seed.line);
      return fn ? [slice(seed.path, fn.start, fn.end)] : [slice(seed.path, 1, 2)];
    },
    rationaleComments: () => [],
    search: no("search"),
    paletteItems: no("paletteItems"),
    estimateTokens: (text) => tokens(text),
    calibrate: () => undefined,
    close: async () => undefined,
  };
  return ix;
}
