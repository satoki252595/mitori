/**
 * `mitori export --html` on the daemon (ADR-0008, gen spec §10.10): the code side of the self-contained export
 * (file text for the static cite peeks, the map's modules) and the two routes (`POST /ws/:ws/export` → `ExportRes` for
 * the CLI, `GET /ws/:ws/export/html` → the file as a download). The HTML itself is `@mitori/doc` `createHtmlExporter`;
 * the CLI writes `--out` [CONS-07].
 */
import { type DiagramId, type DocLang, type ExportReq, MitoriError, type ReaderLevel } from "@mitori/core";
import type { ExportSource } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import type { RouteCtx, RouteHandlers } from "../routes/types.ts";
import { containerDiagram } from "./static-input.ts";
import type { WorkspaceDomain } from "./workspace.ts";

/** Files bigger than this are not read for excerpts (the indexer already skips binaries and excluded paths). */
const MAX_EXCERPT_FILE_BYTES = 2_000_000;

/** What the exporter reads of the checkout: only indexed (non-excluded) files, so secrets files never get that far. */
export function exportSource(indexer: Indexer): ExportSource {
  return {
    async file(path) {
      const entry = indexer.file(path);
      if (entry === null) return null;
      try {
        const whole = await indexer.read(path);
        if (whole.text.length > MAX_EXCERPT_FILE_BYTES) return null;
        return { text: whole.text, blob: whole.blob, lang: entry.lang };
      } catch {
        return null;
      }
    },
    symbol: (path, start, end) => indexer.enclosingSymbol(path, start, end)?.key,
    head: () => indexer.snapshot()?.commit ?? null,
    mapDiagram: () => {
      const ir = containerDiagram(indexer);
      return ir ? { ...ir, id: "dg_map00000" as DiagramId } : null;
    },
    modules: () =>
      indexer.modules().map((m) => {
        if (m.children.length > 0) return m;
        const topFiles = m.paths
          .map((p) => ({ path: p, loc: indexer.file(p)?.loc ?? 0 }))
          .sort((a, b) => b.loc - a.loc || (a.path < b.path ? -1 : 1))
          .slice(0, 5)
          .map((f) => ({
            ...f,
            symbols: indexer
              .symbols(f.path)
              .filter((s) => s.exported)
              .slice(0, 3)
              .map((s) => s.name),
          }));
        return { ...m, topFiles };
      }),
  };
}

const LEVELS: readonly ReaderLevel[] = ["newcomer", "standard", "expert"];
const LANGS: readonly DocLang[] = ["ja", "en"];
const invalid = (field: string, message: string) => new MitoriError("E_INVALID_INPUT", message, { params: { field } });

/** Body of `POST /export` (all fields but `format` optional on the wire: defaults are the app's). */
export function exportReq(raw: unknown, docLang: DocLang): ExportReq {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (raw !== undefined && (raw === null || typeof raw !== "object")) throw invalid("body", "a JSON object body is required");
  if (b.format !== undefined && b.format !== "html") throw invalid("format", "format must be html");
  const level = b.level ?? "standard";
  const lang = b.lang ?? docLang;
  if (!LEVELS.includes(level as ReaderLevel)) throw invalid("level", "level must be newcomer|standard|expert");
  if (!LANGS.includes(lang as DocLang)) throw invalid("lang", "lang must be ja|en");
  for (const k of ["includeDecisions", "excerpts"] as const) if (b[k] !== undefined && typeof b[k] !== "boolean") throw invalid(k, `${k} must be a boolean`);
  return {
    format: "html",
    level: level as ReaderLevel,
    lang: lang as DocLang,
    includeDecisions: b.includeDecisions === true,
    excerpts: b.excerpts !== false,
  };
}

export interface ExportRouteEnv {
  domain(ctx: RouteCtx): Promise<WorkspaceDomain>;
}

export function exportHandlers(env: ExportRouteEnv): RouteHandlers {
  return {
    "POST /ws/:ws/export": async (ctx) => {
      const x = await env.domain(ctx);
      await x.staticReady();
      return x.exporter.export(exportReq(ctx.body, x.doc.manifest()?.primaryLang ?? "ja"));
    },
    "GET /ws/:ws/export/html": async (ctx) => {
      const x = await env.domain(ctx);
      await x.staticReady();
      const q = ctx.query;
      const excerpts = q.get("excerpts");
      if (excerpts !== null && excerpts !== "0" && excerpts !== "1") throw invalid("excerpts", "excerpts must be 0|1");
      const req = exportReq(
        {
          format: "html",
          ...(q.get("level") ? { level: q.get("level") } : {}),
          ...(q.get("lang") ? { lang: q.get("lang") } : {}),
          ...(excerpts === "0" ? { excerpts: false } : {}),
        },
        x.doc.manifest()?.primaryLang ?? "ja",
      );
      return (await x.exporter.export(req)).html;
    },
  };
}
