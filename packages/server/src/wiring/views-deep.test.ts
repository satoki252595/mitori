// The Reader's doc links and the code view's region outline (read paths of the static doc additions, CR rdoc-2).
import { describe, expect, test } from "bun:test";
import type { FileEntry, RepoPath, SectionId, SymbolEntry, WorkspaceKey } from "@mitori/core";
import type { DocStore, HighlightReq } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { docLinks, fileContent } from "./views.ts";

const WS = "ws_000000000000" as WorkspaceKey;

describe("doc-internal links become Reader routes", () => {
  const files = new Map<string, SectionId>([
    ["doc/06-modules.md", "s6" as SectionId],
    ["doc/modules/internal-session.md", "s6/internal-session" as SectionId],
    ["doc/modules/internal-server.md", "s6/internal-server" as SectionId],
  ]);
  test("§6's `modules/<slug>.md` and a module page's sibling `<slug>.md` resolve against the block's file; others stay", () => {
    const html = [
      '<a href="modules/internal-session.md">s</a>',
      '<a href="internal-server.md#x">x</a>',
      '<a href="../decisions/dc_00000000.md">d</a>',
      '<a href="https://example.com/a.md" rel="noopener noreferrer">e</a>',
      '<a href="missing.md">m</a>',
    ].join(" ");
    expect(docLinks(html, "doc/06-modules.md", files, WS)).toContain('<a href="/w/ws_000000000000/doc/s6/internal-session"');
    const fromPage = docLinks(html, "doc/modules/internal-session.md", files, WS);
    expect(fromPage).toContain('<a href="/w/ws_000000000000/doc/s6/internal-server"');
    expect(fromPage).toContain('<a href="../decisions/dc_00000000.md">');
    expect(fromPage).toContain('<a href="https://example.com/a.md"');
    expect(fromPage).toContain('<a href="missing.md">');
  });
});

describe("code view: a file over 1,500 lines carries its region outline", () => {
  const big = Array.from({ length: 1600 }, (_, i) =>
    i === 0 ? "export function Editor() {" : i === 1 ? "  const [a, setA] = useState(0);" : i === 1598 ? "}" : `  // ${i}`,
  ).join("\n");
  const syms = [
    {
      key: "app/Editor.tsx#Editor",
      path: "app/Editor.tsx",
      name: "Editor",
      qualname: "Editor",
      kind: "function",
      start: 1,
      end: 1599,
      exported: true,
      signature: "",
    },
  ] as unknown as SymbolEntry[];
  const indexer = {
    file: () => ({ path: "app/Editor.tsx", lines: 1600, lang: "tsx" }) as unknown as FileEntry,
    read: async () => ({ text: big, blob: "b1" }),
    symbols: () => syms,
  } as unknown as Indexer;
  const doc = { blocksCiting: () => [], index: () => ({ blocks: {}, claims: {} }), manifest: () => ({ primaryLang: "ja" }) } as unknown as DocStore;
  const pool = { run: async () => "" } as unknown as Parameters<typeof fileContent>[2];
  test("regions are labelled in the doc's language with their line ranges; short files have none", async () => {
    const out = await fileContent(indexer, doc, pool, { path: "app/Editor.tsx" as RepoPath, html: false });
    expect(out.regions?.[0]).toEqual({ label: "Editor（関数）", start: 1, end: 1599, depth: 0 });
    expect(out.regions?.[1]).toMatchObject({ label: "状態（useState 1）", start: 2, depth: 1 });
    const small = { ...indexer, file: () => ({ path: "a.ts", lines: 200, lang: "typescript" }) as unknown as FileEntry } as Indexer;
    expect((await fileContent(small, doc, pool, { path: "a.ts" as RepoPath, html: false })).regions).toBeUndefined();
  });
});

export type { HighlightReq };
