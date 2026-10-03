/**
 * CR-PENDING(WP-10a): a minimal `ApiClient` used only while `@mitori/client`'s `createApiClient` is still the
 * M0 `E_UNSUPPORTED` stub (WP-09 implements the real one; `clients.ts` prefers it as soon as it exists).
 * Same contract: route key → method + path (params URL-encoded), JSON bodies, auth + client headers,
 * `x-mitori-rev` reported through `onRev`, non-2xx ⇒ `MitoriError` from the `ApiErrorBody`.
 */

import type { ApiClient, ClientOptions } from "@mitori/client";
import { HTTP_HEADERS, isMitoriErrorData, MitoriError, type RouteKey } from "@mitori/core";

export function routeUrl(
  base: string,
  key: RouteKey,
  params: Record<string, string> | undefined,
  query: Record<string, unknown> | undefined,
): { method: string; url: string } {
  const sp = key.indexOf(" ");
  const method = key.slice(0, sp);
  const path = key.slice(sp + 1).replace(/:([a-zA-Z]+)/g, (_m, name: string) => encodeURIComponent(params?.[name] ?? ""));
  const qs = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return { method, url: `${base}${path}${qs ? `?${qs}` : ""}` };
}

export function createLocalApiClient(opts: ClientOptions): ApiClient {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  return {
    async call(key, args) {
      const { method, url } = routeUrl(opts.base, key, args.params as Record<string, string>, args.query as Record<string, unknown> | undefined);
      const headers: Record<string, string> = { ...opts.headers, [HTTP_HEADERS.client]: `${opts.client.kind}/${opts.client.version}` };
      const token = opts.auth.token();
      if (token) headers[HTTP_HEADERS.authorization] = `${opts.auth.scheme === "session" ? "Mitori-Session" : "Bearer"} ${token}`;
      if (args.idempotencyKey) headers[HTTP_HEADERS.idempotencyKey] = args.idempotencyKey;
      let body: string | undefined;
      if (args.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(args.body);
      }
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      if (args.signal) init.signal = args.signal;
      let res: Response;
      try {
        res = await doFetch(url, init);
      } catch (err) {
        if (args.signal?.aborted) throw new MitoriError("E_CANCELLED", "request aborted");
        throw new MitoriError("E_NOT_READY", "daemon unreachable", { cause: err, retryable: true });
      }
      const rev = res.headers.get(HTTP_HEADERS.rev);
      if (rev !== null && args.onRev) args.onRev(Number(rev));
      if (!res.ok) {
        let data: unknown = null;
        try {
          data = ((await res.json()) as { error?: unknown }).error;
        } catch {
          /* not JSON */
        }
        throw isMitoriErrorData(data) ? MitoriError.from(data) : new MitoriError("E_INTERNAL", `HTTP ${res.status}`);
      }
      // JSON unless the daemon says otherwise (text routes); keeps the whole ROUTE_META table out of the entry chunk
      return ((res.headers.get("content-type") ?? "application/json").includes("json") ? await res.json() : await res.text()) as never;
    },
  };
}
