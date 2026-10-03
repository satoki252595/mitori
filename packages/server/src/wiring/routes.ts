/**
 * Domain route adapters (server spec §8: thin adapters over the owner's public API; DTO conversion only). Owners:
 * indexer, doc, gen, agent, loop (`ROUTE_OWNERS`). Routes not listed answer 501 `E_UNSUPPORTED` (the router), which is
 * where the M3/M4 features (threads, jobs, review rounds, proposals, export) still are.
 */
import type { Engine, UsageLedger } from "@mitori/agent";
import {
  type BlockId,
  type BlockSourceView,
  type DiagramId,
  type DiagramIR,
  type DocLang,
  type EngineId,
  type EngineStatus,
  type FactKind,
  type GenRunId,
  type GenTaskView,
  type GraphView,
  MitoriError,
  type Ok,
  type RepoPath,
  type SearchKind,
  type SectionId,
  type UsageRange,
  type WorkspaceKey,
} from "@mitori/core";
import { DOC_TEXT } from "../contract.ts";
import type { RouteCtx, RouteHandlers } from "../routes/types.ts";
import { blockView, citePeek, docOutline, fileContent, fileTree, mapView, readingOrder, sectionView } from "./views.ts";
import type { WorkspaceDomain } from "./workspace.ts";

export interface RouteEnv {
  /** Domain parts of the workspace behind `ctx` (loads it). */
  domain(ctx: RouteCtx): Promise<WorkspaceDomain>;
  /** `POST /ws/:ws/scan` (WorkspaceManager.rescan). */
  rescan(ws: WorkspaceKey, force: boolean): Promise<void>;
  engines(): Record<EngineId, Engine | null>;
  ledger(): UsageLedger;
  highlighter: Parameters<typeof fileContent>[2];
}

const ok: Ok = { ok: true };
const invalid = (field: string, message: string) => new MitoriError("E_INVALID_INPUT", message, { params: { field } });
const SEARCH_KINDS: readonly SearchKind[] = ["file", "symbol", "module", "fact", "section", "block", "term", "thread"] as SearchKind[];
const LANGS: readonly DocLang[] = ["ja", "en"];

function int(q: URLSearchParams, name: string, def: number | null, min = 0, max = 1_000_000): number {
  const raw = q.get(name);
  if (raw === null || raw === "") {
    if (def === null) throw invalid(name, `${name} is required`);
    return def;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw invalid(name, `${name} must be an integer in ${min}..${max}`);
  return n;
}

function str(q: URLSearchParams, name: string): string {
  const v = q.get(name);
  if (v === null || v === "") throw invalid(name, `${name} is required`);
  return v;
}

const lang = (q: URLSearchParams): DocLang | undefined => {
  const v = q.get("lang");
  return v !== null && (LANGS as readonly string[]).includes(v) ? (v as DocLang) : undefined;
};

const body = <T>(ctx: RouteCtx): T => {
  if (ctx.body === null || typeof ctx.body !== "object") throw invalid("body", "a JSON object body is required");
  return ctx.body as T;
};

/** `GET /engines`: detection is cached by the engines themselves (10 min). */
async function engineStatus(engines: Record<EngineId, Engine | null>): Promise<EngineStatus[]> {
  const out: EngineStatus[] = [];
  for (const e of Object.values(engines)) if (e) out.push(await e.detect().catch(() => null as unknown as EngineStatus));
  return out.filter((s) => s !== null);
}

export function domainHandlers(env: RouteEnv): RouteHandlers {
  const d = env.domain;
  return {
    /* ---- agent ---------------------------------------------------------------------------------------- */
    "GET /engines": () => engineStatus(env.engines()),
    "GET /usage/summary": ({ query }) => {
      const range = (query.get("range") ?? "today") as UsageRange;
      if (!["today", "7d", "30d", "all"].includes(range)) throw invalid("range", "range must be today|7d|30d|all");
      const ws = query.get("ws");
      return ws ? env.ledger().summary(range, ws as WorkspaceKey) : env.ledger().summary(range);
    },

    /* ---- indexer -------------------------------------------------------------------------------------- */
    "GET /ws/:ws/scan": async (ctx) => (await d(ctx)).scan(),
    "POST /ws/:ws/scan": async (ctx) => {
      const x = await d(ctx);
      const force = (ctx.body as { force?: unknown } | undefined)?.force === true;
      void env.rescan(x.info.key, force).catch(() => undefined);
      return { ...x.scan(), state: "running" };
    },
    "GET /ws/:ws/modules": async (ctx) => (await d(ctx)).indexer.modules(),
    "GET /ws/:ws/facts": async (ctx) => {
      const kind = ctx.query.get("kind");
      return (await d(ctx)).indexer.facts(kind ? (kind as FactKind) : undefined);
    },
    "GET /ws/:ws/symbols": async (ctx) => {
      const x = await d(ctx);
      const q = ctx.query.get("q");
      const path = ctx.query.get("path");
      const limit = int(ctx.query, "limit", 50, 1, 500);
      if (q) return x.indexer.findSymbols(q, limit);
      if (path) return x.indexer.symbols(path as RepoPath).slice(0, limit);
      throw invalid("q", "q or path is required");
    },
    "GET /ws/:ws/graph": async (ctx) => {
      const x = await d(ctx);
      const level = ctx.query.get("level") === "file" ? "file" : "module";
      const focus = ctx.query.get("focus") ?? undefined;
      const g = x.indexer.graph(level, focus);
      const ir: DiagramIR = {
        id: `dg_graph${level === "file" ? "f" : "m"}0` as DiagramId,
        kind: "component",
        nodes: g.nodes.map((n) => ({ id: n.id, label: n.label, ...(n.path ? { ref: { path: n.path } } : n.module ? { ref: { module: n.module } } : {}) })),
        edges: g.edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, kind: "imports" as const })),
        groups: [],
        direction: "RIGHT",
        origin: "static",
      };
      const view: GraphView = { level, diagram: ir, layout: await x.layouter.layout(ir) };
      return view;
    },
    "GET /ws/:ws/files/tree": async (ctx) => {
      const x = await d(ctx);
      return fileTree(x.indexer, x.info.name);
    },
    "GET /ws/:ws/files/content": async (ctx) => {
      const x = await d(ctx);
      const q = ctx.query;
      const start = q.get("start");
      const end = q.get("end");
      return fileContent(x.indexer, x.doc, env.highlighter, {
        path: str(q, "path") as RepoPath,
        ...(start ? { start: int(q, "start", 1, 1) } : {}),
        ...(end ? { end: int(q, "end", 1, 1) } : {}),
        html: q.get("html") === "1",
      });
    },
    "GET /ws/:ws/cite": async (ctx) => {
      const x = await d(ctx);
      const q = ctx.query;
      return citePeek(x.indexer, env.highlighter, {
        path: str(q, "path") as RepoPath,
        start: int(q, "start", null, 1),
        end: int(q, "end", null, 1),
        blob: str(q, "blob"),
        ctx: int(q, "ctx", 8, 0, 40),
      });
    },
    "GET /ws/:ws/search": async (ctx) => {
      const x = await d(ctx);
      const kinds = (ctx.query.get("kinds") ?? "file,symbol,module,fact")
        .split(",")
        .filter((k): k is SearchKind => (SEARCH_KINDS as readonly string[]).includes(k));
      return x.indexer.search(str(ctx.query, "q"), kinds, int(ctx.query, "limit", 20, 1, 200));
    },
    "GET /ws/:ws/search/palette": async (ctx) => {
      const x = await d(ctx);
      await x.staticReady();
      return x.palette();
    },
    "GET /ws/:ws/digest": async (ctx) => {
      const x = await d(ctx);
      const max = ctx.query.get("maxTokens");
      return x.indexer.repoPack({ tokenizer: "claude-v5", ...(max ? { maxTokens: int(ctx.query, "maxTokens", 12000, 500, 50000) } : {}) }).text;
    },

    /* ---- doc ------------------------------------------------------------------------------------------- */
    "GET /ws/:ws/map": async (ctx) => {
      const x = await d(ctx);
      await x.staticReady();
      return mapView(x.view, x.indexer, x.layouter, () => 0);
    },
    "GET /ws/:ws/diagrams/:dg": async (ctx) => {
      const x = await d(ctx);
      const ir = x.doc.index().diagrams[ctx.params.dg];
      if (!ir) throw new MitoriError("E_NOT_FOUND", `no diagram ${ctx.params.dg}`, { params: { dg: ctx.params.dg } });
      return { diagram: ir, layout: await x.layouter.layout(ir) };
    },
    "GET /ws/:ws/doc": async (ctx) => {
      const x = await d(ctx);
      await x.staticReady();
      return docOutline(x.doc, x.outlineRev(), 0);
    },
    "GET /ws/:ws/doc/sections/:section": async (ctx) => {
      const x = await d(ctx);
      await x.staticReady();
      const v = await sectionView(x.view, ctx.params.section, lang(ctx.query));
      if (!v) throw new MitoriError("E_NOT_FOUND", `no section ${ctx.params.section}`, { params: { section: ctx.params.section } });
      return v;
    },
    "GET /ws/:ws/doc/text": async (ctx) => {
      const x = await d(ctx);
      const ref = str(ctx.query, "ref");
      const depth = int(ctx.query, "depth", 3, 0, 3);
      const idx = x.doc.index();
      const { order } = readingOrder(x.doc);
      const pick = new Set<SectionId>();
      const sub = (id: SectionId) => {
        pick.add(id);
        for (const c of order.find((s) => s.id === id)?.children ?? []) sub(c);
      };
      let blocks: BlockId[];
      if (ref === "*") blocks = order.flatMap((s) => s.blocks);
      else if (idx.blocks[ref as BlockId]) blocks = [ref as BlockId];
      else {
        sub(ref as SectionId);
        blocks = order.filter((s) => pick.has(s.id)).flatMap((s) => s.blocks);
      }
      const parts: string[] = [];
      let size = 0;
      for (const id of blocks) {
        const b = x.doc.block(id);
        if (!b || Number(b.depth.slice(1)) > depth) continue;
        const piece = `<!-- ${b.id} §${b.section} ${b.depth} -->\n${b.md}`;
        if (size + piece.length > DOC_TEXT.maxChars) {
          parts.push("<!-- truncated -->");
          break;
        }
        parts.push(piece);
        size += piece.length + DOC_TEXT.separator.length;
      }
      return parts.join(DOC_TEXT.separator);
    },
    "GET /ws/:ws/doc/blocks/:block": async (ctx) => {
      const x = await d(ctx);
      const b = x.doc.block(ctx.params.block);
      if (!b) throw new MitoriError("E_NOT_FOUND", `no block ${ctx.params.block}`, { params: { block: ctx.params.block } });
      const v = await blockView(x.view, b, lang(ctx.query));
      const form = ctx.query.get("md");
      if (form !== "marker" && form !== "file") return v;
      const src: BlockSourceView = { ...v, md: form === "marker" ? (x.doc.markerForm(b.id) ?? b.md) : b.md, mdForm: form };
      return src;
    },
    "POST /ws/:ws/doc/blocks/:block/verify": async (ctx) => {
      const x = await d(ctx);
      const { verified } = body<{ verified?: unknown }>(ctx);
      if (typeof verified !== "boolean") throw invalid("verified", "verified must be a boolean");
      const rt = await ctx.runtime();
      const by = ctx.auth.client === "cli" ? "cli" : "web";
      const b = await rt.write("doc.verify", () => x.doc.setVerified(ctx.params.block, verified, by));
      return blockView(x.view, b);
    },
    "GET /ws/:ws/doc/blocks/:block/history": async (ctx) => (await d(ctx)).doc.history(ctx.params.block),
    "GET /ws/:ws/decisions": async (ctx) => (await d(ctx)).doc.decisions(),

    /* ---- gen ------------------------------------------------------------------------------------------- */
    "POST /ws/:ws/gen/estimate": async (ctx) => {
      const x = await d(ctx);
      await x.staticReady();
      return x.gen.estimate(body(ctx));
    },
    "POST /ws/:ws/gen/runs": async (ctx) => {
      const x = await d(ctx);
      const req = body<{ estimateId?: unknown; confirm?: unknown; notBefore?: unknown }>(ctx);
      if (typeof req.estimateId !== "string") throw invalid("estimateId", "estimateId is required");
      if (req.confirm !== true) throw invalid("confirm", "confirm must be true");
      return x.gen.start(req.estimateId as never, typeof req.notBefore === "string" ? { notBefore: req.notBefore as never } : {});
    },
    "GET /ws/:ws/gen/runs": async (ctx) => {
      const x = await d(ctx);
      const run = x.gen.active();
      return { items: run ? [run] : [], next: null };
    },
    "GET /ws/:ws/gen/runs/:run": async (ctx) => {
      const x = await d(ctx);
      const r = x.gen.run(ctx.params.run);
      if (!r) throw new MitoriError("E_NOT_FOUND", `no run ${ctx.params.run}`, { params: { run: ctx.params.run } });
      const tasks: GenTaskView[] = r.tasks.map((t) => {
        const v: GenTaskView = { id: t.id, stage: t.stage, target: t.target, state: t.state, priority: t.priority, attempt: t.attempt, blocks: t.blocks };
        if (t.usage !== undefined) v.usage = t.usage;
        if (t.error !== undefined) v.error = t.error;
        return v;
      });
      return { run: r.run, tasks };
    },
    "POST /ws/:ws/gen/runs/:run/control": async (ctx) => {
      const x = await d(ctx);
      const { action } = body<{ action?: unknown }>(ctx);
      if (action !== "pause" && action !== "resume" && action !== "cancel") throw invalid("action", "action must be pause|resume|cancel");
      return x.gen.control(ctx.params.run as GenRunId, action);
    },
    "POST /ws/:ws/gen/prioritize": async (ctx) => {
      const x = await d(ctx);
      const { section } = body<{ section?: unknown }>(ctx);
      if (typeof section !== "string") throw invalid("section", "section is required");
      x.gen.prioritize(section as SectionId);
      return ok;
    },
    "GET /ws/:ws/gen/suggestions": async (ctx) => (await d(ctx)).suggestions(),
    "POST /ws/:ws/gen/prep": async (ctx) => {
      const x = await d(ctx);
      await x.staticReady();
      return x.gen.session.prep(body(ctx));
    },
    "POST /ws/:ws/gen/ingest": async (ctx) => (await d(ctx)).gen.session.ingest(body(ctx)),
    "POST /ws/:ws/check": async (ctx) => {
      const x = await d(ctx);
      const req = body<{ kind?: unknown; path?: unknown }>(ctx);
      if (req.kind !== "gen-output")
        throw new MitoriError("E_UNSUPPORTED", `check kind ${String(req.kind)} is not wired yet`, { params: { kind: String(req.kind) } });
      if (typeof req.path !== "string") throw invalid("path", "path is required");
      return x.gen.session.check(req.path);
    },

    /* ---- loop (reads only until createLoop, WP-08b) ---------------------------------------------------- */
    "GET /ws/:ws/threads": async (ctx) => {
      await d(ctx);
      return { items: [], next: null };
    },
    "GET /ws/:ws/jobs": async (ctx) => {
      await d(ctx);
      return { items: [], next: null };
    },
    "GET /ws/:ws/checkpoints": async (ctx) => {
      await d(ctx);
      return [];
    },
  };
}
