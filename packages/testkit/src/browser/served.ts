// What a client actually downloads (testing spec §6.5): the response body bytes under a given Accept-Encoding, never the
// size of the file on disk. node:http (not fetch) so the body stays compressed under Bun and Node alike.
import http from "node:http";
import { MitoriError } from "@mitori/core";

interface Served {
  path: string;
  bytes: number;
  contentEncoding: string | null;
  immutable: boolean;
  contentType: string;
}

function get(url: URL, encoding: "br" | "gzip"): Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { "accept-encoding": encoding, "user-agent": "mitori-testkit" } }, (res) => {
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, bytes }));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

/** `immutable` = long-lived (`max-age` ≥ 1 year) and marked immutable, i.e. safe for content-hashed files. */
export function isImmutable(cacheControl: string | undefined): boolean {
  if (!cacheControl) return false;
  const maxAge = /max-age=(\d+)/.exec(cacheControl)?.[1];
  return /\bimmutable\b/.test(cacheControl) && maxAge !== undefined && Number(maxAge) >= 31_536_000;
}

export async function servedBytes(baseUrl: string, paths: readonly string[], encoding: "br" | "gzip"): Promise<readonly Served[]> {
  const out: Served[] = [];
  for (const path of paths) {
    const url = new URL(path, baseUrl);
    const res = await get(url, encoding);
    // only a 2xx body is the asset: a redirect (to a login page, a moved file) would be measured as a few bytes of nothing
    if (res.status < 200 || res.status >= 300) throw new MitoriError("E_NOT_FOUND", `${url.pathname} answered ${res.status}`, { params: { path } });
    const enc = res.headers["content-encoding"];
    const cache = res.headers["cache-control"];
    out.push({
      path,
      bytes: res.bytes,
      contentEncoding: typeof enc === "string" ? enc : null,
      immutable: isImmutable(typeof cache === "string" ? cache : undefined),
      contentType: String(res.headers["content-type"] ?? ""),
    });
  }
  return out;
}
