/** Request building and error decoding shared by the API and SSE clients. Isomorphic (fetch only). */
import { type ApiErrorBody, HTTP_HEADERS, isMitoriErrorData, MitoriError, type RouteKey } from "@mitori/core";
import type { ClientOptions } from "../contract.ts";

/** `"<METHOD> <path>"` → method + path with URL-encoded params (section ids keep their `/` as `%2F`). */
export function routePath(key: RouteKey, params: unknown): { method: string; path: string } {
  const space = key.indexOf(" ");
  const method = key.slice(0, space);
  const p = (params ?? {}) as Record<string, unknown>;
  const path = key.slice(space + 1).replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const v = p[name];
    if (v === undefined || v === null || v === "") throw new MitoriError("E_INVALID_INPUT", `missing path param ${name}`, { params: { field: name } });
    return encodeURIComponent(String(v));
  });
  return { method, path };
}

/** Query string from a flat object (undefined/null skipped). */
export function queryString(query: unknown): string {
  if (query === undefined || query === null) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) if (v !== undefined && v !== null) q.set(k, String(v));
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

/** Headers every request carries: client kind/version, credentials (read per request), extras. */
export function baseHeaders(opts: ClientOptions): Record<string, string> {
  const h: Record<string, string> = { ...opts.headers, [HTTP_HEADERS.client]: `${opts.client.kind}/${opts.client.version}` };
  const token = opts.auth.token();
  if (token !== null) h[HTTP_HEADERS.authorization] = `${opts.auth.scheme === "bearer" ? "Bearer" : "Mitori-Session"} ${token}`;
  return h;
}

/** Non-2xx ⇒ MitoriError from the `ApiErrorBody` (`estimate` kept as a property), anything else ⇒ `E_INTERNAL`. */
export async function errorFromResponse(res: Response): Promise<MitoriError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  const data = (body as Partial<ApiErrorBody> | null)?.error;
  if (!isMitoriErrorData(data)) return new MitoriError("E_INTERNAL", `HTTP ${res.status} without an error body`, { params: { status: res.status } });
  const err = MitoriError.from(data);
  const estimate = (body as ApiErrorBody).estimate;
  if (estimate !== undefined) Object.assign(err, { estimate });
  return err;
}

/** fetch() failures: aborts ⇒ `E_CANCELLED`, network errors ⇒ `E_NOT_READY` (daemon unreachable). */
export function networkError(e: unknown): MitoriError {
  if (e instanceof MitoriError) return e;
  if ((e as { name?: string } | null)?.name === "AbortError") return new MitoriError("E_CANCELLED", "request aborted", { cause: e });
  return new MitoriError("E_NOT_READY", "mitori daemon unreachable", { cause: e, retryable: true });
}
