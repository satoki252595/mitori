/** `AnchorEngine` fake: `codeAnchor` hashes the normalized lines like loop spec §1.1 `snippetHash`. */
import type { AnchorEngine } from "@mitori/anchor";
import { type CodeAnchor, type Hasher, unsupported } from "@mitori/core";

/** Factory. */
export function fakeAnchors(hasher: Hasher): AnchorEngine {
  const no =
    (name: string) =>
    (...a: unknown[]): never =>
      unsupported(`fakeAnchors.${name}`, ...a);
  return {
    codeAnchor(path, start, end, text, blob, symbol): CodeAnchor {
      const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
      const snippet = hasher.xxh3(
        lines
          .slice(start - 1, end)
          .map((l) => l.replace(/\s+/gu, " ").trim())
          .join("\n"),
      );
      const a: CodeAnchor = { path, start, end, blob, snippet };
      if (symbol) a.symbol = symbol;
      return a;
    },
    docAnchor: no("docAnchor"),
    verifyDocQuote: no("verifyDocQuote"),
    lineMap: no("lineMap"),
    reanchor: no("reanchor"),
    reanchorDoc: no("reanchorDoc"),
    reanchorDiagram: no("reanchorDiagram"),
    findQuote: no("findQuote"),
    overlaps: no("overlaps"),
  };
}
