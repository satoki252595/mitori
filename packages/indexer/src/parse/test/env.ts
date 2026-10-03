// Test-only Worker environment over Bun APIs (the production entry lives in @mitori/server): pinned wasm from
// node_modules, Bun xxh3 / sha1 / sha256, node:fs reads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitOid, Hasher, Xxh3 } from "@mitori/core";
import { GRAMMARS, type GrammarId, type ParseWorkerEnv, type ParseWorkerInit, TREE_SITTER_RUNTIME } from "../../contract.ts";

export const REPO_ROOT = join(import.meta.dir, "../../../../..");
const NM = join(REPO_ROOT, "node_modules");

export function xxh3(data: string | Uint8Array): Xxh3 {
  return Bun.hash.xxHash3(data).toString(16).padStart(16, "0");
}

export function gitBlob(data: Uint8Array, algo: "sha1" | "sha256"): GitOid {
  const h = new Bun.CryptoHasher(algo);
  h.update(`blob ${data.length}\0`);
  h.update(data);
  return h.digest("hex");
}

export const hasher: Hasher = {
  xxh3,
  sha256: (d) => new Bun.CryptoHasher("sha256").update(d).digest("hex"),
  gitBlob,
};

export const env: ParseWorkerEnv = {
  readFile: (abs) => readFileSync(abs),
  gitBlob,
  xxh3,
  now: () => performance.now(),
};

let cached: ParseWorkerInit | null = null;

/** Init message with every pinned grammar (bytes read once per process). */
export function workerInit(over: Partial<ParseWorkerInit> = {}): ParseWorkerInit {
  if (cached === null) {
    const grammars: Partial<Record<GrammarId, Uint8Array>> = {};
    for (const [g, v] of Object.entries(GRAMMARS)) grammars[g as GrammarId] = readFileSync(join(NM, v.npm, v.wasm));
    cached = {
      runtime: readFileSync(join(NM, TREE_SITTER_RUNTIME.npm, TREE_SITTER_RUNTIME.wasm)),
      grammars,
      queries: {},
      detectors: [],
      objectFormat: "sha1",
      extractorCode: 1,
    };
  }
  return { ...cached, ...over };
}
