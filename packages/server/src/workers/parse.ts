/**
 * Parse Worker entry (indexer spec §3.3; moved here from the walking skeleton per CR m0-19): `createParseWorker` over
 * Bun hashes and synchronous reads. After each reply a collection runs once ≈ 256 KiB of source were parsed since the
 * last one (cr-requests/WP-02.md §7: peak RSS −25 %). It is a young-generation one, and every 8th (≈ 2 MiB) a full one:
 * a full GC per 256 KiB cost ≈ 156 ms per Worker on the 7k-file Go corpus; the eden passes keep React's peak RSS
 * (ABBA n = 8, 2026-10-12: Go S0–S1 median 1,509.5 → 1,451.9 ms, React peak 1,024.9 → 1,016.0 MiB, Go +4.4 % RSS).
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
const FULL_EVERY = 8;
let since = 0;
let light = 0;

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
      if (++light >= FULL_EVERY) {
        light = 0;
        Bun.gc(true);
      } else Bun.gc(false);
    }
  },
);
