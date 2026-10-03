// Test helper: render the three skeleton tiers of one file through the real Worker handler (in-thread).
import { readFileSync } from "node:fs";
import type { SourceLang } from "@mitori/core";
import { LANG_GRAMMAR, type SkeletonTier } from "../../contract.ts";
import { langOfPath } from "../../lang/detect.ts";
import type { ParseOkResult } from "../../parse/protocol.ts";
import { env, workerInit } from "../../parse/test/env.ts";
import { createWorkerHandler, type WorkerHandlerImpl } from "../../parse/worker.ts";
import { skeletonHeader } from "../render.ts";

let handler: Promise<WorkerHandlerImpl> | null = null;

export function sharedHandler(): Promise<WorkerHandlerImpl> {
  handler ??= createWorkerHandler(env, workerInit());
  return handler;
}

/** Parse `abs` as repo path `path` and return the ok result (null when a content rule excluded it). */
export async function parseMaybe(
  abs: string,
  path: string,
  opts: { lang?: SourceLang; profile?: "full" | "lite" | "text" } = {},
): Promise<ParseOkResult | null> {
  const h = await sharedHandler();
  const lang = opts.lang ?? langOfPath(path).lang;
  const source = readFileSync(abs);
  const res = await h.handle({
    id: 1,
    items: [
      {
        path,
        abs,
        size: source.length,
        lang,
        grammar: LANG_GRAMMAR[lang],
        profile: opts.profile ?? "full",
        knownBlob: null,
        source,
        detectors: [],
        provisionalClass: "source",
        scope: "main",
      },
    ],
  });
  const r = res.items[0];
  if (r?.status === "excluded") return null;
  if (r?.status !== "ok") throw new Error(`not parsed: ${JSON.stringify(r)}`);
  return r as ParseOkResult;
}

/** {@link parseMaybe} that requires the file to be parsed. */
export async function parseFile(abs: string, path: string, opts: { lang?: SourceLang; profile?: "full" | "lite" | "text" } = {}): Promise<ParseOkResult> {
  const r = await parseMaybe(abs, path, opts);
  if (r === null) throw new Error(`excluded by a content rule: ${path}`);
  return r;
}

/** Full skeleton text (header + body) of a parsed file. */
export function skeletonText(r: ParseOkResult, tier: SkeletonTier): string {
  const header = skeletonHeader(
    tier,
    r.path,
    r.lang,
    r.lines,
    r.imports.map((i) => i.spec),
  );
  return `${header}\n${r.skeleton?.[tier] ?? ""}`;
}
