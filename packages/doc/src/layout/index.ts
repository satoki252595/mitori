/**
 * @mitori/doc — `layout/` (owner: WP-04). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { canonicalJson, type DiagramIR, type DiagramLayout, type Hasher, type Logger, MitoriError, type SqlDb, type WorkerPool } from "@mitori/core";
import type { DiagramLayouter } from "../contract.ts";
import { ELK_ENGINE, SEQUENCE_ENGINE, sequenceLayout } from "./elk.ts";
import { toMermaidText } from "./mermaid.ts";
import { ROOMS_ENGINE, roomsLayout } from "./rooms.ts";

const MEM_MAX = 256;

/** Layouter factory [CONS-26]. ELK runs in its own Worker (elk-api.js + embedded elk-worker.min.js) [SC-04]. */
export function createDiagramLayouter(deps: {
  elk: WorkerPool<{ ir: DiagramIR; kind: "layered" | "floorplan"; prev: DiagramLayout | null }, DiagramLayout>;
  db: SqlDb;
  hasher: Hasher;
  log: Logger;
}): DiagramLayouter {
  const mem = new Map<string, DiagramLayout>();
  const log = deps.log.child("doc.layout");
  const remember = (key: string, l: DiagramLayout) => {
    mem.delete(key);
    mem.set(key, l);
    if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
  };
  return {
    async layout(ir, signal) {
      signal?.throwIfAborted();
      // the container map (S1) is a packed building of rooms sized for their labels; other kinds go to ELK
      const engine = ir.kind === "sequence" ? SEQUENCE_ENGINE : ir.kind === "container" ? ROOMS_ENGINE : ELK_ENGINE;
      // the id is not part of the layout input: identical diagrams share one cached layout
      const irHash = deps.hasher.xxh3(canonicalJson({ ...ir, id: null }));
      const key = `${engine}|${irHash}`;
      const hit = mem.get(key);
      if (hit) return hit.diagram === ir.id ? hit : { ...hit, diagram: ir.id };
      const row = deps.db.get<{ json: string }>("SELECT json FROM doc_layouts WHERE ir_hash = ? AND engine = ?", [irHash, engine]);
      if (row) {
        const l = { ...(JSON.parse(row.json) as DiagramLayout), diagram: ir.id };
        remember(key, l);
        return l;
      }
      const t0 = performance.now();
      const out =
        ir.kind === "sequence"
          ? sequenceLayout(ir, irHash)
          : ir.kind === "container"
            ? roomsLayout(ir, irHash)
            : { ...(await deps.elk.run({ ir, kind: "layered", prev: null }, signal)), irHash, diagram: ir.id };
      log.debug("layout", { diagram: ir.id, nodes: ir.nodes.length, ms: Math.round(performance.now() - t0) });
      deps.db.run("INSERT OR REPLACE INTO doc_layouts (ir_hash, engine, diagram, json) VALUES (?, ?, ?, ?)", [irHash, engine, ir.id, JSON.stringify(out)]);
      remember(key, out);
      return out;
    },
    async layoutFloorplan(ir) {
      throw new MitoriError("E_UNSUPPORTED", "floor-plan layout is not available yet (WP-18); use layout() on the container diagram", {
        params: { diagram: ir.id },
      });
    },
    toMermaid: toMermaidText,
  };
}

/**
 * IR → ELK → {@link DiagramLayout} over an ELK port (`{ layout(elkGraph) }`, the daemon's ELK Worker) [CR m1-3]: the
 * composition root adapts the raw ELK pool to the layouter's `WorkerPool<{ir…}, DiagramLayout>` with it.
 */
export { elkLayout } from "./elk.ts";
