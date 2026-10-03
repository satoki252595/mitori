// Deterministic Mermaid text for the Markdown file (§10.2-5). Only GitHub reads it; mitori's UI draws the ELK
// layout. Labels are entity-escaped so `"`, `[`, `]`, `|`, `#`, `;` and newlines never break the syntax.
import type { DiagramIR } from "@mitori/core";

const RESERVED = new Set(["end", "graph", "subgraph", "flowchart", "style", "class", "classdef", "click", "linkstyle", "direction", "default"]);

/** Mermaid-safe id (`[a-z0-9_-]+`; reserved words and leading digits/dashes get an `n_` prefix). */
export function mermaidId(id: string): string {
  const s = id.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "n";
  return RESERVED.has(s) || /^[0-9-]/.test(s) ? `n_${s}` : s;
}

/** Escape a label for a quoted Mermaid label / sequence message. */
const ESC: Record<string, string> = { "#": "#35;", '"': "#quot;", "[": "#91;", "]": "#93;", "|": "#124;", ";": "#59;", "\n": "<br/>" };

export function mermaidLabel(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[#"[\]|;\n]/g, (c) => ESC[c] as string);
}

function flowchart(ir: DiagramIR): string {
  const out = [`flowchart ${ir.direction === "DOWN" ? "TB" : "LR"}`];
  for (const n of ir.nodes) out.push(`  ${mermaidId(n.id)}["${mermaidLabel(n.label)}"]`);
  const children = new Map<string | undefined, string[]>();
  for (const g of ir.groups) children.set(g.parent, [...(children.get(g.parent) ?? []), g.id]);
  const members = new Map<string, string[]>();
  for (const n of ir.nodes) if (n.group) members.set(n.group, [...(members.get(n.group) ?? []), n.id]);
  const byId = new Map(ir.groups.map((g) => [g.id, g]));
  const emit = (gid: string, depth: number, seen: Set<string>) => {
    const g = byId.get(gid);
    if (!g || seen.has(gid)) return;
    seen.add(gid);
    const pad = "  ".repeat(depth);
    out.push(`${pad}subgraph ${mermaidId(`g_${g.id}`)} ["${mermaidLabel(g.label)}"]`);
    for (const c of children.get(g.id) ?? []) emit(c, depth + 1, seen);
    for (const m of members.get(g.id) ?? []) out.push(`${pad}  ${mermaidId(m)}`);
    out.push(`${pad}end`);
  };
  const seen = new Set<string>();
  for (const g of ir.groups) if (!g.parent || !byId.has(g.parent)) emit(g.id, 1, seen);
  for (const e of ir.edges) {
    const arrow = e.label ? `-->|${mermaidLabel(e.label)}|` : "-->";
    out.push(`  ${mermaidId(e.from)} ${arrow} ${mermaidId(e.to)}`);
  }
  return `${out.join("\n")}\n`;
}

function sequence(ir: DiagramIR): string {
  const out = ["sequenceDiagram"];
  for (const n of ir.nodes) out.push(`  participant ${mermaidId(n.id)} as ${mermaidLabel(n.label)}`);
  const msgs = ir.edges.map((e, i) => ({ e, i })).sort((a, b) => (a.e.seq ?? Number.MAX_SAFE_INTEGER) - (b.e.seq ?? Number.MAX_SAFE_INTEGER) || a.i - b.i);
  for (const { e } of msgs) out.push(`  ${mermaidId(e.from)}->>${mermaidId(e.to)}: ${mermaidLabel(e.label ?? "")}`);
  return `${out.join("\n")}\n`;
}

/** Mermaid source (ends with a newline; the caller wraps it in a ```` ```mermaid ```` fence). */
export function toMermaidText(ir: DiagramIR): string {
  return ir.kind === "sequence" ? sequence(ir) : flowchart(ir);
}
