// Hash primitives over Bun's native implementations (xxHash3 in Zig, sha via BoringSSL).
import type { GitOid, Sha256, Xxh3 } from "@mitori/core";

const enc = new TextEncoder();

/** xxh3-64 as 16 lowercase hex chars. */
export function xxh3Hex(data: string | Uint8Array): Xxh3 {
  return Bun.hash.xxHash3(data).toString(16).padStart(16, "0");
}

/** sha256 as 64 lowercase hex chars. */
export function sha256Hex(data: string | Uint8Array): Sha256 {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

/** git blob id: hash of `blob <len>\0<bytes>` (no copy of the content). */
export function gitBlobOid(data: Uint8Array, algo: "sha1" | "sha256"): GitOid {
  const h = new Bun.CryptoHasher(algo);
  h.update(enc.encode(`blob ${data.byteLength}\0`));
  h.update(data);
  return h.digest("hex");
}
