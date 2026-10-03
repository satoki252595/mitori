/**
 * Skeleton parse Worker (WP-11a, M0.5): proves web-tree-sitter + the six grammar wasm run inside the compiled binary.
 * The main thread reads the embedded wasm and sends the bytes in `init` (indexer spec §3.2), so this file uses no
 * Bun API and no embedded path. WP-INT replaces it with `packages/server/src/workers/parse.ts`
 * (→ `@mitori/indexer` `createParseWorker`), keeping the same build wiring.
 */
import { Language, Parser } from "web-tree-sitter";
import { serveWorker } from "./protocol.ts";

export interface ParseInit {
  runtime: Uint8Array;
  grammars: Record<string, Uint8Array>;
}

export interface ParseProbe {
  lang: string;
  source: string;
}

export interface ParseProbeResult {
  lang: string;
  root: string;
  nodes: number;
  hasError: boolean;
  ms: number;
}

let parser: Parser | null = null;
const languages = new Map<string, Language>();

serveWorker({
  async init(p: ParseInit) {
    const t0 = performance.now();
    await Parser.init({ wasmBinary: p.runtime });
    parser = new Parser();
    for (const [lang, bytes] of Object.entries(p.grammars)) languages.set(lang, await Language.load(bytes));
    return { ms: performance.now() - t0, langs: [...languages.keys()] };
  },
  parse(items: ParseProbe[]): ParseProbeResult[] {
    if (!parser) throw new Error("parse before init");
    const p = parser;
    return items.map(({ lang, source }) => {
      const language = languages.get(lang);
      if (!language) throw new Error(`no grammar for ${lang}`);
      const t0 = performance.now();
      p.setLanguage(language);
      const tree = p.parse(source);
      if (!tree) throw new Error(`parse failed for ${lang}`);
      try {
        const root = tree.rootNode;
        return { lang, root: root.type, nodes: root.descendantCount, hasError: root.hasError, ms: performance.now() - t0 };
      } finally {
        tree.delete();
      }
    });
  },
});
