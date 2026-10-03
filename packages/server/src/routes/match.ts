/**
 * Route matching over `ROUTE_META` keys (`"<METHOD> <path>"` relative to `API_PREFIX`). Paths are split on the RAW
 * `/` before decoding, so an encoded `%2F` stays inside one param (section ids contain `/`). A literal segment
 * beats a param at the same position.
 */
import { MitoriError, ROUTE_META, type RouteKey, type RouteMeta } from "@mitori/core";

type Segment = { lit: string } | { param: string };

interface Compiled {
  key: RouteKey;
  method: string;
  segments: Segment[];
  meta: RouteMeta;
}

export interface RouteMatch {
  key: RouteKey;
  meta: RouteMeta;
  params: Record<string, string>;
}

const table = new Map<string, Compiled[]>();
for (const [key, meta] of Object.entries(ROUTE_META) as [RouteKey, RouteMeta][]) {
  const [method = "", path = ""] = key.split(" ");
  const segments: Segment[] = path
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith(":") ? { param: s.slice(1) } : { lit: s }));
  const bucket = `${method} ${segments.length}`;
  const list = table.get(bucket) ?? [];
  list.push({ key, method, segments, meta });
  table.set(bucket, list);
}

/** Every route key (exhaustiveness tests). */
export const ROUTE_KEYS = Object.keys(ROUTE_META) as RouteKey[];

/** Match `method` + the path BELOW the API prefix (raw, still percent-encoded). Null when nothing matches. */
export function matchRoute(method: string, rawPath: string): RouteMatch | null {
  const raw = rawPath.split("/").filter((s, i, all) => s !== "" || (i > 0 && i < all.length - 1));
  const candidates = table.get(`${method} ${raw.length}`);
  if (!candidates) return null;
  let decoded: string[];
  try {
    decoded = raw.map((s) => decodeURIComponent(s));
  } catch {
    throw new MitoriError("E_INVALID_INPUT", "malformed percent-encoding in path");
  }
  let best: { c: Compiled; score: number } | null = null;
  for (const c of candidates) {
    let score = 0;
    let ok = true;
    for (let i = 0; i < c.segments.length; i++) {
      const seg = c.segments[i] as Segment;
      if ("lit" in seg) {
        if (seg.lit !== decoded[i]) {
          ok = false;
          break;
        }
        score += 1;
      } else if (decoded[i] === "") {
        ok = false;
        break;
      }
    }
    if (ok && (best === null || score > best.score)) best = { c, score };
  }
  if (!best) return null;
  const params: Record<string, string> = {};
  best.c.segments.forEach((seg, i) => {
    if ("param" in seg) params[seg.param] = decoded[i] as string;
  });
  return { key: best.c.key, meta: best.c.meta, params };
}
