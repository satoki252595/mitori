import {
  CHARS_PER_TOKEN,
  type CodeSlice,
  type FileEntry,
  type GitOid,
  type LineNo,
  type RepoPath,
  type SymbolEntry,
  type SymbolKind,
  type TextKind,
  type TokenizerId,
} from "@mitori/core";
import type { ResolvedImport } from "@mitori/indexer";
import type { BundleBuilderDeps } from "../deps.ts";
import { blobOf } from "./fake-anchor.ts";

// A read-only in-memory Indexer for WP-08a tests (the shared `indexerFromGolden` is still an M0 stub): files from a
// path → text map, Go symbols and imports extracted with a few regexes, `estimateTokens` from `CHARS_PER_TOKEN`.

const CJK = /[぀-ヿ㐀-䶿一-鿿]/gu;

export function estimateTokens(text: string, kind: TextKind, tokenizer: TokenizerId): number {
  const co = CHARS_PER_TOKEN[tokenizer];
  if (kind === "markdown_ja" || kind === "markdown_en") {
    const cjk = text.match(CJK)?.length ?? 0;
    return cjk / co.markdown_ja + (text.length - cjk) / co.markdown_en;
  }
  return text.length / co[kind];
}

const langOf = (path: string): FileEntry["lang"] =>
  /\.go$/.test(path) ? "go" : /\.tsx?$/.test(path) ? "typescript" : /\.py$/.test(path) ? "python" : /\.rs$/.test(path) ? "rust" : "generic";

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Top-level Go funcs / methods / structs / interfaces with their extents (`}` at column 0 closes them). */
function goSymbols(path: string, text: string): SymbolEntry[] {
  const lines = splitLines(text);
  const blob = blobOf(text);
  const out: SymbolEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fn = /^func (?:\((\w+) \*?(\w+)\) )?(\w+)\(/.exec(line);
    const ty = /^type (\w+) (struct|interface)\b/.exec(line);
    if (!fn && !ty) continue;
    let end = i + 1;
    if (!/\}\s*$/.test(line) || /\{\s*$/.test(line)) {
      while (end < lines.length && lines[end] !== "}") end++;
      end++; // 1-based line of the closing brace
    }
    const name = (fn ? fn[3] : ty?.[1]) as string;
    const recv = fn?.[2];
    const kind: SymbolKind = fn ? (recv ? "method" : "function") : ty?.[2] === "interface" ? "interface" : "struct";
    const qualname = recv ? `${recv}.${name}` : name;
    out.push({
      key: `${path}#${qualname}`,
      path,
      blob,
      kind,
      name,
      qualname,
      start: i + 1,
      end: Math.min(end, lines.length),
      signature: line.replace(/\s*\{\s*$/, "").slice(0, 200),
      sigHash: "0".repeat(16),
      bodyHash: "0".repeat(16),
      exported: /^[A-Z]/.test(name),
    });
  }
  return out;
}

export interface FakeIndexerOptions {
  /** Go module path for resolving `import "<module>/dir"` into files of the fake repo. */
  module?: string;
  /** Extra symbols per path (used instead of the Go extractor). */
  symbols?: Record<RepoPath, SymbolEntry[]>;
  /** Paths served as not indexed (`file()` returns the entry with this exclusion). */
  excluded?: Record<RepoPath, NonNullable<FileEntry["excluded"]>>;
}

export type FakeIndexer = BundleBuilderDeps["indexer"] & { reads: { path: string; start: number; end: number }[]; texts: string[] };

export function fakeIndexer(files: Record<string, string>, opts: FakeIndexerOptions = {}): FakeIndexer {
  const reads: FakeIndexer["reads"] = [];
  const texts: string[] = [];
  const entries = new Map<string, FileEntry>();
  for (const [path, text] of Object.entries(files)) {
    const lines = splitLines(text);
    const entry: FileEntry = {
      path,
      blob: blobOf(text),
      size: text.length,
      lang: langOf(path),
      class: /(_test\.go|\.test\.ts|test_.*\.py)$/.test(path) ? "test" : /\.(md|txt)$/.test(path) ? "docs" : "source",
      lines: lines.length,
      loc: lines.filter((l) => l.trim() !== "").length,
      tokensEst: Math.round(text.length / 2.3),
    };
    const excluded = opts.excluded?.[path];
    if (excluded) entry.excluded = excluded;
    entries.set(path, entry);
  }
  const symbolCache = new Map<string, SymbolEntry[]>();
  const symbols = (path: string): SymbolEntry[] => {
    let s = symbolCache.get(path);
    if (!s) {
      s = opts.symbols?.[path] ?? (langOf(path) === "go" && files[path] !== undefined ? goSymbols(path, files[path] as string) : []);
      symbolCache.set(path, s);
    }
    return s;
  };
  const imports = (path: string): ResolvedImport[] => {
    const text = files[path];
    if (text === undefined || langOf(path) !== "go") return [];
    const out: ResolvedImport[] = [];
    splitLines(text).forEach((line, i) => {
      const m = /^\s*(?:import\s+)?(?:\w+\s+)?"([^"]+)"\s*$/.exec(line);
      if (!m || !/^(?:import|\t|\s)/.test(line)) return;
      const spec = m[1] as string;
      const internal = opts.module && spec.startsWith(`${opts.module}/`) ? spec.slice(opts.module.length + 1) : null;
      const to =
        internal === null
          ? []
          : Object.keys(files).filter(
              (f) => f.startsWith(`${internal}/`) && !f.slice(internal.length + 1).includes("/") && f.endsWith(".go") && !f.endsWith("_test.go"),
            );
      out.push({
        spec,
        line: i + 1,
        kind: "static",
        names: [],
        from: path,
        to,
        ...(internal === null ? (spec.includes(".") ? { external: spec } : { stdlib: true as const }) : {}),
      });
    });
    return out;
  };
  return {
    reads,
    texts,
    estimateTokens,
    file: (path) => entries.get(path) ?? null,
    currentText: async (path) => {
      texts.push(path);
      return files[path] ?? null;
    },
    symbols,
    imports,
    dependents: (path) => {
      const out: { path: RepoPath; kind: "import"; weight: number }[] = [];
      for (const f of Object.keys(files)) if (f !== path && imports(f).some((i) => i.to.includes(path))) out.push({ path: f, kind: "import", weight: 1 });
      return out;
    },
    enclosingSymbol: (path, start, end) => {
      let best: SymbolEntry | null = null;
      for (const s of symbols(path)) if (s.start <= start && s.end >= end && (!best || s.end - s.start < best.end - best.start)) best = s;
      return best;
    },
    module: () => null,
    read: async (path, range, o): Promise<CodeSlice> => {
      const text = files[path];
      if (text === undefined) throw new Error(`fake indexer: no such file ${path}`);
      const lines = splitLines(text);
      const start: LineNo = range?.start ?? 1;
      const end: LineNo = Math.min(range?.end ?? lines.length, lines.length);
      reads.push({ path, start, end });
      const body = lines.slice(start - 1, end);
      const numbered = o?.numbered === true;
      const out = numbered ? body.map((l, i) => `${start + i}|${l}`) : body;
      const blob: GitOid = entries.get(path)?.blob ?? blobOf(text);
      return { path, blob, start, end, text: out.join("\n"), numbered, tokens: Math.round(out.join("\n").length / 2.3), redactions: 0 };
    },
  };
}
