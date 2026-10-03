/**
 * Browser login nonces (ADR-0009 R1, SEC-06): `POST /auth/nonce {to}` (CLI) mints a single-use, 60 s nonce and the
 * URL `http://127.0.0.1:<port>/auth#n=<nonce>&to=<path>` (fragment: never sent to the server, never in logs or
 * Referer). In memory only — a nonce never needs to survive a restart.
 */
import { type Clock, type Iso8601, MitoriError, type NonceRes, type Random } from "@mitori/core";
import { DAEMON } from "../contract.ts";
import { newToken } from "./crypto.ts";

export interface NonceStore {
  /** Mint a nonce for an in-app redirect path (`E_INVALID_INPUT` for anything but a same-origin path). */
  issue(to: string | undefined, port: number): NonceRes;
  /** Consume once: unknown, reused or expired ⇒ `E_AUTH_REQUIRED`. Returns the validated redirect. */
  consume(nonce: string): { to: string };
  /** Live nonces (tests). */
  size(): number;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A redirect target must be an absolute path of this origin: `/…`, not `//host` / `/\host` (protocol-relative in
 * browsers), no backslash, no control characters, ≤ 2 KiB [SRV-I-009].
 */
export function validateRedirect(to: unknown): string {
  if (to === undefined || to === null || to === "") return "/";
  const bad = () => new MitoriError("E_INVALID_INPUT", "`to` must be an in-app path", { params: { field: "to" } });
  if (typeof to !== "string" || to.length > 2048 || !to.startsWith("/") || to.startsWith("//") || to.includes("\\") || CONTROL.test(to)) throw bad();
  let url: URL;
  try {
    url = new URL(to, "http://127.0.0.1");
  } catch {
    throw bad();
  }
  if (url.origin !== "http://127.0.0.1") throw bad();
  return `${url.pathname}${url.search}${url.hash}`;
}

export function createNonceStore(opts: { random: Random; clock: Clock; ttlMs?: number }): NonceStore {
  const ttl = opts.ttlMs ?? DAEMON.nonceTtlMs;
  const live = new Map<string, { to: string; expires: number }>();
  const prune = () => {
    const now = opts.clock.now();
    for (const [k, v] of live) if (v.expires <= now) live.delete(k);
  };
  return {
    issue(to, port) {
      const path = validateRedirect(to);
      prune();
      const nonce = newToken(opts.random);
      const expires = opts.clock.now() + ttl;
      live.set(nonce, { to: path, expires });
      const expiresAt: Iso8601 = new Date(expires).toISOString();
      return { url: `http://127.0.0.1:${port}/auth#n=${nonce}&to=${encodeURIComponent(path)}`, expiresAt };
    },
    consume(nonce) {
      const entry = typeof nonce === "string" ? live.get(nonce) : undefined;
      if (entry) live.delete(nonce);
      if (!entry || entry.expires <= opts.clock.now())
        throw new MitoriError("E_AUTH_REQUIRED", "login link expired or already used", { hint: "run `mitori open` again" });
      return { to: entry.to };
    },
    size: () => {
      prune();
      return live.size;
    },
  };
}
