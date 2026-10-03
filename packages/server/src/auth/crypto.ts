/** HMAC, constant-time comparison and token encoding shared by bearer, session and health-proof code. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Random } from "@mitori/core";

/** 256-bit random token, base64url (43 chars). */
export function newToken(random: Random): string {
  return Buffer.from(random.bytes(32)).toString("base64url");
}

/** `HMAC-SHA256(key, data)` as lowercase hex. */
export function hmacHex(key: string | Uint8Array, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/** Constant-time string equality (length leaks only). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
