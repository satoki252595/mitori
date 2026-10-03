/**
 * CLI / MCP / hook credential: a 256-bit bearer token minted on every daemon start and published only through the
 * 0600 registry (`~/.mitori/daemon.json`). `GET /health?challenge=<32 hex>` answers `proof = HMAC(token, challenge)`
 * so the CLI can tell the real daemon from a squatter on the port before it sends the token [SEC-06].
 */
import type { Random } from "@mitori/core";
import { hmacHex, newToken, safeEqual } from "./crypto.ts";

/** Health challenge format. */
export const CHALLENGE_RE = /^[0-9a-f]{32}$/;

export interface BearerAuth {
  /** The token (registry only; never logged). */
  readonly token: string;
  /** Constant-time check of a presented token. */
  check(presented: string): boolean;
  /** Health proof for a validated challenge. */
  proof(challenge: string): string;
}

/** `HMAC-SHA256(token, challenge)` hex — the value the CLI recomputes. */
export function healthProof(token: string, challenge: string): string {
  return hmacHex(token, challenge);
}

export function createBearer(random: Random): BearerAuth {
  const token = newToken(random);
  return {
    token,
    check: (presented) => safeEqual(presented, token),
    proof: (challenge) => healthProof(token, challenge),
  };
}
