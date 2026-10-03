/**
 * @mitori/client — `http/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { HTTP_HEADERS, MitoriError, ROUTE_META, type RouteMeta } from "@mitori/core";
import type { ApiClient, ClientOptions } from "../contract.ts";
import { baseHeaders, errorFromResponse, networkError, queryString, routePath } from "./request.ts";

/** CLI / MCP / hook health probe with the HMAC proof check, BEFORE any bearer is sent [SEC-06, CR m1-89]. */
export { probeDaemon } from "./probe.ts";

/** Typed API client over `fetch` (CR m0-10). */
export function createApiClient(opts: ClientOptions): ApiClient {
  const base = opts.base.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return {
    async call(key, args) {
      const meta: RouteMeta = ROUTE_META[key];
      if (meta.kind === "sse") throw new MitoriError("E_INVALID_INPUT", `${key} is a stream: use the SSE client`);
      const { method, path } = routePath(key, args.params);
      const headers = baseHeaders(opts);
      if (args.idempotencyKey !== undefined) headers[HTTP_HEADERS.idempotencyKey] = args.idempotencyKey;
      const init: RequestInit = { method, headers };
      if (args.body !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(args.body);
      }
      if (args.signal) init.signal = args.signal;
      let res: Response;
      try {
        res = await doFetch(`${base}${path}${queryString(args.query)}`, init);
      } catch (e) {
        throw networkError(e);
      }
      if (!res.ok) throw await errorFromResponse(res);
      const rev = res.headers.get(HTTP_HEADERS.rev);
      if (rev !== null && args.onRev) {
        const n = Number(rev);
        if (Number.isSafeInteger(n)) args.onRev(n);
      }
      try {
        return meta.kind === "text" || meta.kind === "download" ? await res.text() : await res.json();
      } catch (e) {
        throw new MitoriError("E_INTERNAL", `${key}: unreadable response body`, { cause: e });
      }
    },
  } as ApiClient;
}
