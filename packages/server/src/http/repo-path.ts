/**
 * `RepoPath` query parameters at the HTTP trust boundary (core `parseRepoPath`, SRV-I-013): the router validates
 * and NFC-normalizes `?path=` before any handler runs, so a traversal attempt never reaches a file-reading adapter.
 * The raw value is decoded strictly (`decodeURIComponent` rejects overlong / invalid UTF-8, which URLSearchParams
 * would silently turn into U+FFFD). Symlinks leaving the repo are the indexer's check (it knows the real tree).
 */
import { MitoriError, parseRepoPath, type RouteKey } from "@mitori/core";

/** Routes whose query declares `path: RepoPath` (api §9). */
export const REPO_PATH_QUERY_ROUTES: ReadonlySet<RouteKey> = new Set<RouteKey>([
  "GET /ws/:ws/files/content",
  "GET /ws/:ws/cite",
  "GET /ws/:ws/symbols",
  "GET /ws/:ws/threads",
]);

const invalid = (reason: string) => new MitoriError("E_INVALID_INPUT", `invalid repo path: ${reason}`, { params: { field: "path", reason } });

function strictDecode(s: string): string | null {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/** Validate `?path=` in place (`E_INVALID_INPUT` on any violation; absent is fine). */
export function checkRepoPathQuery(url: URL): void {
  const raw: string[] = [];
  for (const part of url.search.replace(/^\?/, "").split("&")) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    if (strictDecode(eq < 0 ? part : part.slice(0, eq)) === "path") raw.push(eq < 0 ? "" : part.slice(eq + 1));
  }
  if (raw.length === 0) return;
  if (raw.length > 1) throw invalid("repeated");
  const decoded = strictDecode(raw[0] as string);
  if (decoded === null) throw invalid("encoding");
  const r = parseRepoPath(decoded);
  if (!r.ok) throw invalid(String(r.error.params?.reason ?? "invalid"));
  url.searchParams.set("path", r.value);
}
