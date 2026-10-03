/**
 * API + SSE clients of the tab (CR m0-10: `@mitori/client` factories with the session token from
 * `localStorage[LOCAL_KEYS.session]`). While WP-09's factories are still `E_UNSUPPORTED` stubs, the local
 * minimal implementations stand in (CR-PENDING(WP-10a), removed once `@mitori/client` lands).
 */
import { type ApiClient, type ConnectionState, createApiClient, createSseClient, type SseClient } from "@mitori/client";
import { API_PREFIX, type Clock, LOCAL_KEYS, MitoriError, type Random } from "@mitori/core";
import { getItem } from "../storage.ts";
import { createLocalApiClient } from "./api.ts";
import { createLocalSseClient } from "./sse.ts";

declare const __MITORI_VERSION__: string;
export const WEB_VERSION: string = typeof __MITORI_VERSION__ === "string" ? __MITORI_VERSION__ : "dev";

const random: Random = {
  bytes(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  },
};
const clock: Clock = { now: () => Date.now(), iso: () => new Date().toISOString() };

const token = () => getItem("local", LOCAL_KEYS.session);

export function makeClients(onState: (s: ConnectionState) => void): { api: ApiClient; sse: SseClient } {
  const base = { base: API_PREFIX, auth: { scheme: "session" as const, token }, client: { kind: "web" as const, version: WEB_VERSION } };
  let api: ApiClient;
  let sse: SseClient;
  try {
    api = createApiClient(base);
  } catch (err) {
    if (!MitoriError.is(err, "E_UNSUPPORTED")) throw err;
    api = createLocalApiClient(base);
  }
  try {
    sse = createSseClient({ ...base, random, clock, onState });
  } catch (err) {
    if (!MitoriError.is(err, "E_UNSUPPORTED")) throw err;
    sse = createLocalSseClient({ ...base, random, clock, onState });
  }
  return { api, sse };
}

export function tempKey(): string {
  return `tmp_${crypto.randomUUID()}`;
}
