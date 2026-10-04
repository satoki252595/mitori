// The pre-laid-out SVG of a diagram block, for the in-app Reader as well as the export (NC-03: the app drew §2
// 見取り図 — the product's namesake — and every §3 flow as a list of names, while the exported file drew them).
import type { Block, DiagramIR, DiagramLayout } from "@mitori/core";
import { fromMermaid, mermaidFence } from "./mermaid.ts";
import { diagramSvg } from "./svg.ts";

/** A diagram block's IR: from the sidecar (`block.diagram`), else read back from its Mermaid fence. */
export function blockDiagramIr(b: Pick<Block, "id" | "md" | "diagram" | "kind">, diagrams: Readonly<Record<string, DiagramIR>>): DiagramIR | null {
  if (b.kind !== "diagram" && !b.md.includes("```mermaid")) return null;
  if (b.diagram && diagrams[b.diagram]) return diagrams[b.diagram] as DiagramIR;
  const fence = mermaidFence(b.md);
  return fence ? fromMermaid(fence, `dg_${b.id.slice(2)}` as DiagramIR["id"]) : null;
}

/** Put the SVG at the start of the block's `figure.mdiagram` (the node list stays as its text alternative). */
export function withDiagramSvg(html: string, ir: DiagramIR, layout: DiagramLayout, label: string): string {
  const svg = diagramSvg(ir, layout, label);
  return html.replace(
    /<figure class="mdiagram"([^>]*)>/,
    (_m, rest: string) => `<figure class="mdiagram"${rest.replace(/ data-[wh]="[^"]*"/g, "")} data-w="${layout.width}" data-h="${layout.height}">${svg}`,
  );
}
