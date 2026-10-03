/** Diagram IR inside a block line (gen spec §6.2 `$defs/diagram`, §6.3 V20). Hand-written, zero-dependency. */
import type { DiagramEdge, DiagramGroup, DiagramNode, ModuleId } from "@mitori/core";
import type { GenDiagramDraft } from "../contract.ts";
import { isObject, short } from "./claims.ts";

const KINDS = new Set(["sequence", "flow", "component", "context", "container", "dependency", "er"]);
const SHAPES = new Set(["box", "store", "actor", "external", "queue", "note"]);
const EDGE_KINDS = new Set(["imports", "calls", "data", "http", "event", "depends", "message"]);
const ID_RE = /^[a-z0-9_-]{1,32}$/;

/** Problem in a diagram (rule V20). */
export interface DiagramProblem {
  /** Pointer under the line. */
  at: string;
  /** Expected. */
  expected: string;
  /** Found. */
  actual: string;
}

/** Limits for this task (flows: 12 nodes / 20 edges). */
export interface DiagramLimits {
  /** Max nodes. */
  nodes: number;
  /** Max edges. */
  edges: number;
  /** Modules a `ref.module` may name. */
  modules: ReadonlySet<ModuleId>;
}

/** Validate and normalize a diagram (defaults: `groups: []`, `direction: "RIGHT"`); unknown keys are dropped. */
export function validateDiagram(raw: unknown, lim: DiagramLimits): { diagram: GenDiagramDraft | null; problems: DiagramProblem[] } {
  const problems: DiagramProblem[] = [];
  const bad = (at: string, expected: string, actual: unknown) => problems.push({ at: `/diagram${at}`, expected, actual: short(actual) });
  if (!isObject(raw)) {
    bad("", "diagram object {kind, nodes, edges}", raw);
    return { diagram: null, problems };
  }
  const kind = raw.kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) bad("/kind", `one of ${[...KINDS].join(", ")}`, kind);
  if (raw.title !== undefined && (typeof raw.title !== "string" || raw.title.length > 60)) bad("/title", "string ≤ 60", raw.title);
  const nodes: DiagramNode[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 1) bad("/nodes", "non-empty array", raw.nodes);
  else {
    if (raw.nodes.length > lim.nodes) bad("/nodes", `at most ${lim.nodes} nodes`, raw.nodes.length);
    nodeLoop: for (const [i, n] of raw.nodes.entries()) {
      const at = `/nodes/${i}`;
      if (!isObject(n)) {
        bad(at, "node object", n);
        continue;
      }
      if (typeof n.id !== "string" || !ID_RE.test(n.id)) {
        bad(`${at}/id`, "id [a-z0-9_-]{1,32}", n.id);
        continue;
      }
      if (ids.has(n.id)) {
        bad(`${at}/id`, "unique node id", n.id);
        continue;
      }
      ids.add(n.id);
      if (typeof n.label !== "string" || n.label.length < 1 || n.label.length > 60) {
        bad(`${at}/label`, "label 1..60", n.label);
        continue;
      }
      const node: DiagramNode = { id: n.id, label: n.label };
      if (n.sublabel !== undefined) {
        if (typeof n.sublabel !== "string" || n.sublabel.length > 60) {
          bad(`${at}/sublabel`, "string ≤ 60", n.sublabel);
          continue;
        }
        node.sublabel = n.sublabel;
      }
      if (n.shape !== undefined) {
        if (typeof n.shape !== "string" || !SHAPES.has(n.shape)) {
          bad(`${at}/shape`, `one of ${[...SHAPES].join(", ")}`, n.shape);
          continue;
        }
        node.shape = n.shape as NonNullable<DiagramNode["shape"]>;
      }
      if (n.group !== undefined) {
        if (typeof n.group !== "string" || !ID_RE.test(n.group)) {
          bad(`${at}/group`, "group id", n.group);
          continue;
        }
        node.group = n.group;
      }
      if (n.ref !== undefined) {
        if (!isObject(n.ref)) {
          bad(`${at}/ref`, "ref object", n.ref);
          continue;
        }
        const ref: NonNullable<DiagramNode["ref"]> = {};
        for (const k of ["module", "path", "symbol", "section"] as const) {
          const v = n.ref[k];
          if (v === undefined) continue;
          if (typeof v !== "string") {
            bad(`${at}/ref/${k}`, "string", v);
            continue nodeLoop;
          }
          if (k === "module") {
            if (!lim.modules.has(v as ModuleId)) {
              bad(`${at}/ref/module`, "a module id given in the task", v);
              continue nodeLoop;
            }
            ref.module = v as ModuleId;
          } else if (k === "symbol") ref.symbol = v as `${string}#${string}`;
          else if (k === "section") ref.section = v as NonNullable<typeof ref.section>;
          else ref.path = v;
        }
        node.ref = ref;
      }
      nodes.push(node);
    }
  }
  const edges: DiagramEdge[] = [];
  const edgeIds = new Set<string>();
  if (!Array.isArray(raw.edges)) bad("/edges", "array", raw.edges);
  else {
    if (raw.edges.length > lim.edges) bad("/edges", `at most ${lim.edges} edges`, raw.edges.length);
    for (const [i, e] of raw.edges.entries()) {
      const at = `/edges/${i}`;
      if (!isObject(e)) {
        bad(at, "edge object", e);
        continue;
      }
      if (typeof e.id !== "string" || !ID_RE.test(e.id) || edgeIds.has(e.id)) {
        bad(`${at}/id`, "unique edge id [a-z0-9_-]{1,32}", e.id);
        continue;
      }
      edgeIds.add(e.id);
      if (typeof e.from !== "string" || !ids.has(e.from)) {
        bad(`${at}/from`, "an existing node id", e.from);
        continue;
      }
      if (typeof e.to !== "string" || !ids.has(e.to)) {
        bad(`${at}/to`, "an existing node id", e.to);
        continue;
      }
      if (typeof e.kind !== "string" || !EDGE_KINDS.has(e.kind)) {
        bad(`${at}/kind`, `one of ${[...EDGE_KINDS].join(", ")}`, e.kind);
        continue;
      }
      const edge: DiagramEdge = { id: e.id, from: e.from, to: e.to, kind: e.kind as DiagramEdge["kind"] };
      if (e.label !== undefined) {
        if (typeof e.label !== "string" || e.label.length > 60) {
          bad(`${at}/label`, "string ≤ 60", e.label);
          continue;
        }
        edge.label = e.label;
      }
      if (e.seq !== undefined) {
        if (!Number.isInteger(e.seq) || (e.seq as number) < 1) {
          bad(`${at}/seq`, "integer ≥ 1", e.seq);
          continue;
        }
        edge.seq = e.seq as number;
      }
      edges.push(edge);
    }
  }
  if (kind === "sequence" && Array.isArray(raw.edges) && edges.length === raw.edges.length) {
    const seqs = edges.map((e) => e.seq ?? 0).sort((a, b) => a - b);
    if (seqs.some((s, i) => s !== i + 1)) bad("/edges", "seq numbered 1..n without gaps", seqs.join(","));
  }
  const groups: DiagramGroup[] = [];
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups) || raw.groups.length > 10) bad("/groups", "array of ≤ 10 groups", raw.groups);
    else
      for (const [i, g] of raw.groups.entries()) {
        if (!isObject(g) || typeof g.id !== "string" || !ID_RE.test(g.id) || typeof g.label !== "string" || g.label.length > 60) {
          bad(`/groups/${i}`, "group {id, label ≤ 60}", g);
          continue;
        }
        const group: DiagramGroup = { id: g.id, label: g.label };
        if (typeof g.parent === "string") group.parent = g.parent;
        groups.push(group);
      }
  }
  let direction: GenDiagramDraft["direction"] = "RIGHT";
  if (raw.direction !== undefined) {
    if (raw.direction !== "RIGHT" && raw.direction !== "DOWN") bad("/direction", "RIGHT or DOWN", raw.direction);
    else direction = raw.direction;
  }
  if (problems.length > 0) return { diagram: null, problems };
  const diagram: GenDiagramDraft = { kind: kind as GenDiagramDraft["kind"], nodes, edges, groups, direction };
  if (typeof raw.title === "string") diagram.title = raw.title;
  return { diagram, problems };
}
