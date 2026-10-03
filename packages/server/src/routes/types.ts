/** Handler shapes of the router. Domain route adapters (WP-INT) use the same types. */
import type { ApiRoutes, RequestId, RouteKey, RouteMeta, WorkspaceKey } from "@mitori/core";
import type { AuthContext, WorkspaceRuntime } from "../contract.ts";

/** Everything a handler gets about one request (all gates already passed). */
export interface RouteCtx<K extends RouteKey = RouteKey> {
  key: K;
  meta: RouteMeta;
  /** Decoded path params. */
  params: ApiRoutes[K]["params"];
  /** Raw query (numbers are strings on the wire; handlers parse). */
  query: URLSearchParams;
  /** Parsed JSON body (`undefined` when none); handlers validate its shape. */
  body: unknown;
  auth: AuthContext;
  req: Request;
  url: URL;
  requestId: RequestId;
  /** Aborted when the client goes away, or at the long-poll deadline. */
  signal: AbortSignal;
  /** `:ws` param (registered, validated), else null. */
  ws: WorkspaceKey | null;
  /** The workspace runtime (lazy load). Throws `E_WS_NOT_FOUND` on routes without `:ws`. */
  runtime(): Promise<WorkspaceRuntime>;
  /** Keep the connection open past the server idle timeout (SSE, long-poll). */
  holdOpen(): void;
}

/** A handler returns the route's response DTO (serialized per `RouteMeta.kind`) or a ready Response. */
export type RouteHandler<K extends RouteKey = RouteKey> = (ctx: RouteCtx<K>) => ApiRoutes[K]["res"] | Response | Promise<ApiRoutes[K]["res"] | Response>;

/** Handler table; a missing entry answers 501 `E_UNSUPPORTED` (server spec §8). */
export type RouteHandlers = { [K in RouteKey]?: RouteHandler<K> };
