/**
 * HMAC, hashing, constant-time comparison and token encoding for bearer, session, health-proof, trust and CSP
 * code. Bun's native hasher instead of `node:crypto`: loading the node polyfill costs ~5 MB of idle RSS
 * (`srv.rss.idleEmpty` ≤ 30 MB).
 */
import type { Random } from "@mitori/core";

/** 256-bit random token, base64url (43 chars). */
export function newToken(random: Random): string {
  return Buffer.from(random.bytes(32)).toString("base64url");
}

/** `HMAC-SHA256(key, data)` as lowercase hex. */
export function hmacHex(key: string | Uint8Array, data: string): string {
  return new Bun.CryptoHasher("sha256", key).update(data).digest("hex");
}

/** sha256 of UTF-8 text. */
export function sha256(data: string, encoding: "hex" | "base64" = "hex"): string {
  return new Bun.CryptoHasher("sha256").update(data).digest(encoding);
}

/** Constant-time string equality (length leaks only). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
