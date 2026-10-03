/**
 * CR batch 1 (architect, 2026-10-03, CR m0-10): the `@mitori/client` contract. `ConnectionState`, `EntityKey`,
 * `SseClient` and `ApiClient` moved here from `apps/web/src/contract.ts` §5 (the web contract re-exports them
 * under the same names; only `ApiClient.call` args gained `onRev?`); the factory options are new.
 * THIS file is the source of truth for @mitori/client.
 * - Any change to an exported name or shape is a contract change: weekly CR batch (label `contract-change`),
 *   recorded in `packages/core/CR-LEDGER.md` (architect answers within 48 h).
 * - Declared functions are `E_UNSUPPORTED` stubs in the owning sub-directory; a pointer comment
 *   (// `name` → module) marks each place. Implement them there; keep the signature.
 */

/**
 * @file mitori — typed fetch + SSE client (`@mitori/client`), shared by the web app, the CLI and the MCP shim.
 *
 * Status: AUTHORITATIVE for `packages/client` (owner: WP-09). Prose: `docs/design/specs/server.md` §5 (SSE hub),
 * `docs/design/specs/ux.md` §12.3, api conventions in `packages/core/src/api.ts` (header comment).
 *
 * Boundaries: imports `@mitori/core` only (PACKAGE_DEPS). Isomorphic (browser + Bun): `fetch` streams only, no
 * EventSource (it cannot send `authorization`), no `Bun.*`/`node:*`. Entropy and time come from the injected
 * core ports (`Random`, `Clock`); timers are the platform's `setTimeout`.
 */

import type {
  ApiRoutes,
  ClientKind,
  Clock,
  Random,
  RouteKey,
  SseEvent,
  SseEventType,
  WorkspaceKey,
} from "@mitori/core";

/* ============================================================================
 * 1. Connection + SSE (moved from the web contract §5, shapes unchanged)
 * ========================================================================== */

/** Connection state of the tab ↔ daemon link. */
export type ConnectionState =
  | { kind: "connecting" }
  | { kind: "live"; since: number }
  | { kind: "retrying"; attempt: number; nextInMs: number }
  | { kind: "auth_expired" }          // 401 (session revoked / >30 days idle / new port) ⇒ show `mitori open` command; sessions survive daemon restarts [UXP-07]
  | { kind: "version_mismatch"; daemon: string; web: string }
  | { kind: "stopped"; reason: string }; // `server.shutdown`

/** Entity key used for SSE de-duplication (`<type>:<id>`). */
export type EntityKey = `${"thread" | "job" | "block" | "proposal" | "checkpoint" | "run" | "task" | "round" | "ws"}:${string}`;

/**
 * SSE client (R1) [CONS-04, SEC-06]: ONE `fetch()` stream per tab at `GET /api/v1/events?ws=<ws>&last=<seq>`
 * with `authorization: Mitori-Session <token>` (EventSource cannot send headers). Resume key = the
 * daemon-global `seq` of the last event; a `hello.boot` different from the remembered one ⇒ resync.
 * De-duplication: workspace entities by (ws, `rev`) — `entityRev[key]` = highest envelope `rev` or
 * `x-mitori-rev` that produced the value, upserts with `rev ≤ entityRev[key]` dropped; global entities
 * (`ws:<key>` summaries, engines, scheduler) by `seq`. `resync` ⇒ refetch every mounted resource.
 * Unknown `type` ⇒ ignored (forward compatible).
 */
export interface SseClient {
  /**
   * Connect (optionally scoped to a workspace). On any drop the client reconnects with 0.5 s × 2ⁿ backoff
   * (cap 10 s, ±20 % jitter) and `?last=<seq>`; the server replays or sends `resync`.
   */
  connect(ws: WorkspaceKey | null): void;
  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends SseEventType>(type: T, fn: (e: Extract<SseEvent, { type: T }>) => void): () => void;
  /** Record a mutation response revision for an entity. */
  noteRev(key: EntityKey, rev: number): void;
  /** True when an event for `key` at `rev` is stale and must be dropped. */
  isStale(key: EntityKey, rev: number): boolean;
  /** Last envelope revision seen per workspace. */
  rev(ws: WorkspaceKey): number;
  /** Last daemon-global sequence seen (resume key). */
  seq(): number;
  /** Connection state (reactive: the web store mirrors it from {@link SseClientOptions.onState}). */
  readonly state: ConnectionState;
  /** Close. */
  close(): void;
}

/* ============================================================================
 * 2. Typed API client
 * ========================================================================== */

/**
 * Typed API client (shared with CLI and MCP shim). Sends `content-type: application/json` on bodies, the auth
 * header of {@link ClientOptions.auth}, `x-mitori-client` and `idempotency-key` when given.
 */
export interface ApiClient {
  /**
   * Call a route. Throws `MitoriError` (with `MitoriErrorData` from the `ApiErrorBody`) on non-2xx; a body that is
   * not an `ApiErrorBody` becomes `E_INTERNAL`. `onRev` receives `x-mitori-rev` (workspace mutations) before the
   * promise resolves, so the caller can `SseClient.noteRev` the entity it changed [CR m0-10].
   */
  call<K extends RouteKey>(
    key: K,
    args: {
      params: ApiRoutes[K]["params"];
      query?: ApiRoutes[K]["query"];
      body?: ApiRoutes[K]["body"];
      idempotencyKey?: string;
      signal?: AbortSignal;
      onRev?: (rev: number) => void;
    },
  ): Promise<ApiRoutes[K]["res"]>;
}

/* ============================================================================
 * 3. Factories (CR m0-10)
 * ========================================================================== */

/**
 * Credentials sent on every authenticated route (api.ts conventions, ADR-0009 R1, SEC-06). `token()` is read per
 * request, so a token exchanged or rotated later is picked up; `null` sends no `authorization` header.
 */
export type ClientAuth =
  /** Browser: `authorization: Mitori-Session <token>` (token in `localStorage[LOCAL_KEYS.session]`). */
  | { scheme: "session"; token: () => string | null }
  /** CLI / MCP shim / hooks: `authorization: Bearer <token>` (registry `~/.mitori/daemon.json`, mode 0600). */
  | { scheme: "bearer"; token: () => string | null };

/** Options shared by both factories. */
export interface ClientOptions {
  /** API base INCLUDING `API_PREFIX`: browser `/api/v1` (same origin), CLI `http://127.0.0.1:<port>/api/v1`. */
  base: string;
  /** How requests authenticate. */
  auth: ClientAuth;
  /** Sent as `x-mitori-client: <kind>/<version>` (logged; `ROUTE_META.clients`); the SSE client compares `hello.version`. */
  client: { kind: ClientKind; version: string };
  /** Extra headers on every request, e.g. `x-mitori-agent` (MCP shim), `x-mitori-waiter` (`mitori review`). */
  headers?: Readonly<Record<string, string>>;
  /** Fetch implementation; default `globalThis.fetch` (tests pass the in-process server's handler). */
  fetch?: typeof fetch;
}

/** SSE options: entropy (backoff jitter) and time (`ConnectionState.live.since`) come from core ports. */
export interface SseClientOptions extends ClientOptions {
  /** Jitter source (±20 % of each backoff step). */
  random: Random;
  /** Clock for `live.since`. */
  clock: Clock;
  /** Called on every {@link ConnectionState} change (the web session store mirrors it into `$state`). */
  onState?: (state: ConnectionState) => void;
}

// `createApiClient` → ./http/index.ts
// `createSseClient` → ./sse/index.ts
