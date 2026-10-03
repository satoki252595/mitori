// Anchor capture (loop spec §1.2) for the server's two-step thread creation [CR m1-68]: `capture` runs OUTSIDE the
// write slot (async file reads) and the review engine applies the result inside it. The engine's synchronous port
// can capture doc and diagram members (block text is in memory); a code member needs the async path.
import type { AnchorEngine, AnchorSnapshot } from "@mitori/anchor";
import { splitLines } from "@mitori/anchor";
import { type Anchor, type AnchorInput, type CodeAnchor, MitoriError, parseRepoPath } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import type { CapturedAnchor } from "../contract.ts";

/** Range text kept in `rev_anchor_snapshots` (bytes). */
const SNAPSHOT_TEXT_MAX = 4096;

/** Ports. */
export interface CaptureDeps {
  indexer: Pick<Indexer, "file" | "currentText" | "currentBlob" | "enclosingSymbol" | "blobText">;
  doc: Pick<DocStore, "block" | "blockText" | "claims">;
  anchors: Pick<AnchorEngine, "codeAnchor" | "docAnchor" | "verifyDocQuote" | "lineMap">;
}

function capUtf8(s: string, max: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= max) return s;
  return new TextDecoder().decode(bytes.subarray(0, max)).replace(/�$/u, "");
}

/** Doc member (+ the code member derived from its claim, §1.2.1-5); synchronous. */
function docMember(deps: CaptureDeps, input: NonNullable<AnchorInput["doc"]>): { doc: Anchor["doc"]; code: CodeAnchor | null } {
  const block = deps.doc.block(input.block);
  if (!block) throw new MitoriError("E_NOT_FOUND", `block ${input.block} not found`, { params: { block: input.block } });
  const text = deps.doc.blockText(block.id) ?? "";
  const claims = deps.doc.claims(block.id);
  const spans = claims.flatMap((c) => {
    const at = c.quote === "" ? -1 : text.indexOf(c.quote);
    return at < 0 ? [] : [{ id: c.id, start: at, end: at + c.quote.length }];
  });
  const start = Math.max(0, Math.min(input.selStart, text.length));
  const end = Math.max(start, Math.min(input.selEnd, text.length));
  if (input.quote && !deps.anchors.verifyDocQuote(text, input.quote))
    throw new MitoriError("E_INVALID_INPUT", "the selected text does not match the block (stale view?)", { params: { block: block.id } });
  const doc = deps.anchors.docAnchor(block.id, text, block.hash, start, end, spans);
  const claim = doc.claim ? claims.find((c) => c.id === doc.claim) : undefined;
  const cite = claim?.cites[0] ?? claims.flatMap((c) => c.cites)[0];
  const code: CodeAnchor | null = cite
    ? { path: cite.path, start: cite.start, end: cite.end, blob: cite.blob, snippet: cite.snippet, ...(cite.symbol ? { symbol: cite.symbol } : {}) }
    : null;
  return { doc, code };
}

/** The synchronous capture port of the review engine (doc / diagram inputs; code needs {@link captureAnchor}). */
export function captureSync(deps: CaptureDeps, input: AnchorInput): CapturedAnchor {
  if (input.code)
    throw new MitoriError("E_PRECONDITION", "a code anchor is captured outside the write slot (createLoop().capture)", { params: { primary: input.primary } });
  const anchor: Anchor = { primary: input.primary };
  if (input.doc) {
    const d = docMember(deps, input.doc);
    if (d.doc) anchor.doc = d.doc;
    if (d.code) anchor.code = d.code;
  }
  if (input.diagram) anchor.diagram = { ...input.diagram };
  if (!anchor.doc && !anchor.code && !anchor.diagram) throw new MitoriError("E_INVALID_INPUT", "an anchor needs a doc, code or diagram member");
  return { anchor };
}

/** `createLoop(...).capture`. */
export async function captureAnchor(deps: CaptureDeps, input: AnchorInput, _previous: Anchor | null): Promise<CapturedAnchor> {
  const anchor: Anchor = { primary: input.primary };
  const aux: NonNullable<CapturedAnchor["aux"]> = {};
  if (input.doc) {
    const d = docMember(deps, input.doc);
    if (d.doc) anchor.doc = d.doc;
    if (d.code && !input.code) anchor.code = d.code;
  }
  if (input.code) {
    const path = parseRepoPath(input.code.path);
    if (!path.ok) throw MitoriError.from(path.error);
    const file = deps.indexer.file(path.value);
    if (!file) throw new MitoriError("E_NOT_FOUND", `file ${path.value} is not indexed`, { params: { path: path.value } });
    const text = await deps.indexer.currentText(path.value);
    if (text === null) throw new MitoriError("E_NOT_FOUND", `file ${path.value} is gone`, { params: { path: path.value } });
    const blob = deps.indexer.currentBlob(path.value) ?? file.blob;
    let { start, end } = input.code;
    // the client saw an older blob: carry its range over (Myers line map) before stamping
    if (input.code.blob && input.code.blob !== blob) {
      const old = await deps.indexer.blobText(input.code.blob).catch(() => null);
      if (old !== null) {
        const map = deps.anchors.lineMap(old, text);
        const s = map.mapStart(start);
        start = s;
        end = Math.max(s, map.mapEnd(end, s));
      }
    }
    const lines = splitLines(text);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > Math.max(1, lines.length))
      throw new MitoriError("E_INVALID_INPUT", `range ${start}-${end} is outside ${path.value} (${lines.length} lines)`, { params: { path: path.value } });
    const sym = deps.indexer.enclosingSymbol(path.value, start, end);
    const cr = input.code.charRange ? { from: input.code.charRange.start, to: input.code.charRange.end } : undefined;
    anchor.code = deps.anchors.codeAnchor(path.value, start, end, text, blob, sym?.key, cr);
    const snap: Pick<AnchorSnapshot, "text" | "symStart"> = { text: capUtf8(lines.slice(start - 1, end).join("\n"), SNAPSHOT_TEXT_MAX) };
    if (sym) snap.symStart = sym.start;
    aux.code = snap;
  }
  if (input.diagram) anchor.diagram = { ...input.diagram };
  if (!anchor.doc && !anchor.code && !anchor.diagram) throw new MitoriError("E_INVALID_INPUT", "an anchor needs a doc, code or diagram member");
  return Object.keys(aux).length > 0 ? { anchor, aux } : { anchor };
}
