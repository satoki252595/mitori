/**
 * Parse Worker entry (indexer spec §3.3; moved here from the walking skeleton per CR m0-19): `createParseWorker` over
 * Bun hashes and synchronous reads. After each reply a full GC runs once ≈ 256 KiB of source were parsed since the
 * last one (cr-requests/WP-02.md §7: peak RSS −25 %, no measurable wall time).
 */
import { readFileSync } from "node:fs";
import type { GitOid, Xxh3 } from "@mitori/core";
import { createParseWorker, INDEXER_FORMAT, type ParseBatchRequest, type ParseBatchResponse, type ParseWorkerEnv, type ParseWorkerInit } from "@mitori/indexer";
import { serveInitWorker } from "./protocol.ts";

const xxh3 = (data: string | Uint8Array): Xxh3 => Bun.hash.xxHash3(data).toString(16).padStart(16, "0");

function gitBlob(data: Uint8Array, algo: "sha1" | "sha256"): GitOid {
  const h = new Bun.CryptoHasher(algo);
  h.update(`blob ${data.length}\0`);
  h.update(data);
  return h.digest("hex");
}

const env: ParseWorkerEnv = { readFile: (abs) => readFileSync(abs), gitBlob, xxh3, now: () => performance.now() };

const GC_EVERY_BYTES = 262_144;
let since = 0;

/** The pool factory sends the wasm bytes; the rest of the init is the indexer's own (queries: the embedded text). */
type Init = Pick<ParseWorkerInit, "runtime" | "grammars"> & Partial<ParseWorkerInit>;

serveInitWorker<Init, ParseBatchRequest, ParseBatchResponse>(
  async (init) => {
    const h = await createParseWorker(env, { queries: {}, detectors: [], objectFormat: "sha1", extractorCode: INDEXER_FORMAT.extractorCode, ...init });
    return (req) => h.handle(req);
  },
  (req) => {
    for (const it of req.items) since += it.size;
    if (since >= GC_EVERY_BYTES) {
      since = 0;
      Bun.gc(true);
    }
  },
);
