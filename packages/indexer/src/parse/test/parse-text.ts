// Test helper: run one in-memory source text through the shared in-thread Worker handler.
import type { FileClass, SourceLang } from "@mitori/core";
import { LANG_GRAMMAR, type ParseProfile } from "../../contract.ts";
import { langOfPath } from "../../lang/detect.ts";
import type { ParseItemExt, ParseOkResult, ParseResultExt } from "../protocol.ts";
import { createWorkerHandler, type WorkerHandlerImpl } from "../worker.ts";
import { env, workerInit } from "./env.ts";

let shared: Promise<WorkerHandlerImpl> | null = null;

export function handler(): Promise<WorkerHandlerImpl> {
  shared ??= createWorkerHandler(env, workerInit());
  return shared;
}

let id = 1;

export async function parseResult(
  path: string,
  text: string | Uint8Array,
  opts: { lang?: SourceLang; profile?: ParseProfile; cls?: FileClass; skipContentRules?: boolean } = {},
): Promise<ParseResultExt> {
  const h = await handler();
  const lang = opts.lang ?? langOfPath(path).lang;
  const source = typeof text === "string" ? new TextEncoder().encode(text) : text;
  const item: ParseItemExt = {
    path,
    abs: `/nonexistent/${path}`,
    size: source.length,
    lang,
    grammar: LANG_GRAMMAR[lang],
    profile: opts.profile ?? "full",
    knownBlob: null,
    source,
    detectors: [],
    provisionalClass: opts.cls ?? (opts.profile === "lite" ? "test" : "source"),
    scope: "main",
  };
  if (opts.skipContentRules === true) item.skipContentRules = true;
  const res = await h.handle({ id: id++, items: [item] });
  return res.items[0] as ParseResultExt;
}

export async function parseText(path: string, text: string, opts: Parameters<typeof parseResult>[2] = {}): Promise<ParseOkResult> {
  const r = await parseResult(path, text, opts);
  if (r.status !== "ok") throw new Error(`expected ok for ${path}, got ${JSON.stringify(r)}`);
  return r;
}

/** `qualname kind start-end exported` lines (compact assertions). */
export function syms(r: ParseOkResult): string[] {
  return r.symbols.map((s) => `${s.qualname} ${s.kind} ${s.start}-${s.end}${s.exported ? " exp" : ""}`);
}
