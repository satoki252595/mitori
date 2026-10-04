// The inverse of `layout/mermaid.ts` `toMermaidText` (gen spec §10.2-5): a diagram block whose IR is gone — the doc was
// edited outside mitori, imported without its sidecar, or a merge dropped `doc.index.json` — still has the Mermaid fence
// the codec wrote. The export reads that fence back into an IR so the diagram is drawn (layout by the daemon, SVG by
// `svg.ts`) instead of falling back to a bare list of labels. Only the subset mitori itself writes is understood
// (flowchart with subgraphs, sequenceDiagram); anything else returns null and the block keeps its text alternative.
import type { DiagramEdge, DiagramGroup, DiagramId, DiagramIR, DiagramNode } from "@mitori/core";

const decodeLabel = (s: string): string =>
  s
    .replace(/<br\/>/g, "\n")
    .replace(/#quot;/g, '"')
    .replace(/#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));

const MAX_NODES = 300;

export function fromMermaid(src: string, id: DiagramId): DiagramIR | null {
  const lines = src.split("\n").map((l) => l.replace(/\s+$/, ""));
  const head = lines.find((l) => l.trim() !== "")?.trim() ?? "";
  if (head === "sequenceDiagram") return sequence(lines, id);
  const m = /^flowchart (LR|TB)$/.exec(head);
  return m ? flowchart(lines, id, m[1] === "TB" ? "DOWN" : "RIGHT") : null;
}

function sequence(lines: string[], id: DiagramId): DiagramIR | null {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    let m = /^participant (\S+) as (.*)$/.exec(l);
    if (m) {
      nodes.push({ id: m[1] as string, label: decodeLabel(m[2] as string) });
      continue;
    }
    m = /^(\S+?)->>(\S+?): ?(.*)$/.exec(l);
    if (m) {
      const label = decodeLabel(m[3] as string);
      edges.push({ id: `e${edges.length + 1}`, from: m[1] as string, to: m[2] as string, kind: "message", seq: edges.length + 1, ...(label ? { label } : {}) });
    }
  }
  if (nodes.length === 0 || nodes.length > MAX_NODES) return null;
  const ids = new Set(nodes.map((n) => n.id));
  return { id, kind: "sequence", nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)), groups: [], direction: "RIGHT", origin: "human" };
}

function flowchart(lines: string[], id: DiagramId, direction: DiagramIR["direction"]): DiagramIR | null {
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const groups: DiagramGroup[] = [];
  const stack: string[] = [];
  for (const raw of lines.slice(1)) {
    const l = raw.trim();
    if (l === "") continue;
    let m = /^subgraph (\S+) \["(.*)"\]$/.exec(l);
    if (m) {
      const gid = m[1] as string;
      const parent = stack[stack.length - 1];
      groups.push({ id: gid, label: decodeLabel(m[2] as string), ...(parent ? { parent } : {}) });
      stack.push(gid);
      continue;
    }
    if (l === "end") {
      stack.pop();
      continue;
    }
    m = /^(\S+?)\["(.*)"\]$/.exec(l);
    if (m) {
      nodes.set(m[1] as string, { id: m[1] as string, label: decodeLabel(m[2] as string) });
      continue;
    }
    m = /^(\S+) -->(?:\|(.*)\|)? (\S+)$/.exec(l);
    if (m) {
      const label = m[2] ? decodeLabel(m[2]) : "";
      edges.push({ id: `e${edges.length + 1}`, from: m[1] as string, to: m[3] as string, kind: "depends", ...(label ? { label } : {}) });
      continue;
    }
    // a bare id inside a subgraph: membership
    const bare = /^(\S+)$/.exec(l);
    const g = stack[stack.length - 1];
    const n = bare ? nodes.get(bare[1] as string) : undefined;
    if (n && g) n.group = g;
  }
  if (nodes.size === 0 || nodes.size > MAX_NODES) return null;
  return { id, kind: "flow", nodes: [...nodes.values()], edges: edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)), groups, direction, origin: "human" };
}

/** The Mermaid source inside a diagram block's Markdown (` ```mermaid … ``` `), or null. */
export function mermaidFence(md: string): string | null {
  const m = /```mermaid\n([\s\S]*?)```/.exec(md);
  return m ? (m[1] as string) : null;
}
