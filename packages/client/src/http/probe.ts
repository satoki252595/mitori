/**
 * CLI / MCP side of the health challenge [SEC-06, SRV-AT-09]: before a bearer token is sent anywhere, call
 * `GET /health?challenge=<32 hex>` WITHOUT credentials and require `proof = HMAC-SHA256(token, challenge)`. A
 * squatter on the port (or a reused PID) cannot produce it, so it never sees the token.
 * CR-PENDING(WP-09): not exported from the package index yet (see docs/design/cr-requests/WP-09.md).
 */
import { API_PREFIX, type HealthRes, MitoriError } from "@mitori/core";

/** `DAEMON.healthTimeoutMs` (server contract; the client cannot import the server). */
const HEALTH_TIMEOUT_MS = 1500;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data))));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verified health of the daemon at `origin` (`http://127.0.0.1:<port>`), or null when it does not answer in time,
 * is not mitori, or fails the proof. `challenge` = 16 fresh random bytes from the caller's `Random`.
 */
export async function probeDaemon(opts: {
  origin: string;
  token: string;
  challenge: Uint8Array;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<HealthRes | null> {
  if (opts.challenge.byteLength !== 16) throw new MitoriError("E_INVALID_INPUT", "challenge must be 16 bytes");
  const challenge = hex(opts.challenge);
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let health: HealthRes;
  try {
    const res = await doFetch(`${opts.origin.replace(/\/+$/, "")}${API_PREFIX}/health?challenge=${challenge}`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? HEALTH_TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) return null;
    health = (await res.json()) as HealthRes;
  } catch {
    return null;
  }
  if (health?.ok !== true || typeof health.proof !== "string") return null;
  return sameText(health.proof, await hmacHex(opts.token, challenge)) ? health : null;
}
