/**
 * API + SSE clients of the tab (CR m0-10: `@mitori/client` factories with the session token from
 * `localStorage[LOCAL_KEYS.session]`). The local fallbacks are gone since `@mitori/client` landed (CR m1-94).
 */
import { type ApiClient, type ConnectionState, createApiClient, createSseClient, type SseClient } from "@mitori/client";
import { API_PREFIX, type Clock, LOCAL_KEYS, type Random } from "@mitori/core";
import { getItem } from "../storage.ts";

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
  return { api: createApiClient(base), sse: createSseClient({ ...base, random, clock, onState }) };
}

export function tempKey(): string {
  return `tmp_${crypto.randomUUID()}`;
}
