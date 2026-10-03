// What the exporter needs from the code side (the doc package does no file I/O and cannot import the indexer):
// supplied by the composition root (server wiring), optional so a doc-only export still works (cites then carry no
// code excerpt). CR-PENDING(WP-13): the contract's `createHtmlExporter` deps have no such port — see
// docs/design/cr-requests/WP-13.md.
import type { DiagramIR, GitOid, MapView, RepoPath, SourceLang, SymbolKey } from "@mitori/core";

/** One source file at the current checkout. */
export interface ExportFile {
  /** Whole text (the exporter redacts the whole file, then cuts windows — a secret that needs context is still found). */
  text: string;
  /** Current blob. */
  blob: GitOid;
  /** Language (selects the grammar of the static peek). */
  lang: SourceLang;
}

/** Code-side data for the export. */
export interface ExportSource {
  /** The file at the current checkout, or null (missing, excluded, binary, over the size cap). */
  file(path: RepoPath): Promise<ExportFile | null>;
  /** Enclosing symbol of a range (peek header). */
  symbol?(path: RepoPath, start: number, end: number): SymbolKey | undefined;
  /** Modules of the map (room sizes, `topFiles`); without them the rooms carry only their diagram labels. */
  modules?(): MapView["modules"];
  /** HEAD of the checkout the export is made from (the manifest only knows the commit of the last generation run). */
  head?(): string | null;
  /** The container diagram of the index, used when the doc has none of its own (a doc imported without its sidecar). */
  mapDiagram?(): DiagramIR | null;
}
