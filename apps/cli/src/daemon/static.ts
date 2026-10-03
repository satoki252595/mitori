/**
 * Serving the embedded web dist from memory: precompressed variant negotiation (br > gzip > identity), immutable
 * caching for content-hashed files, SPA fallback, and the daemon-wide security headers (api `SECURITY_HEADERS`,
 * SEC-17). Lookups go through the asset map only, so no request path ever reaches the filesystem.
 */
import { SECURITY_HEADERS } from "@mitori/core";
import type { WebAssets } from "../build/assets.ts";

const TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  wasm: "application/wasm",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

export type Encoding = "br" | "gzip" | "identity";

/** Best available encoding for an `accept-encoding` header (q=0 excludes; ties prefer br). */
export function negotiate(accept: string | null, has: { br: boolean; gz: boolean }): Encoding {
  const q = new Map<string, number>();
  for (const part of (accept ?? "").split(",")) {
    const [name = "", ...params] = part.trim().toLowerCase().split(";");
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    q.set(name, qp ? Number(qp.slice(2)) || 0 : 1);
  }
  const weight = (enc: string) => q.get(enc) ?? q.get("*") ?? 0;
  if (has.br && weight("br") > 0 && weight("br") >= weight("gzip")) return "br";
  if (has.gz && weight("gzip") > 0) return "gzip";
  if (has.br && weight("br") > 0) return "br";
  return "identity";
}

/**
 * Security headers with the CSP `{headInline}` placeholder resolved against the shell's inline scripts (the zero-CLS
 * head script of WP-10a); with no inline script the hash source is dropped.
 */
export function securityHeaders(indexHtml: string): Record<string, string> {
  const hashes = [...indexHtml.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1] ?? "")
    .filter((body) => body.trim() !== "")
    .map((body) => `'sha256-${new Bun.CryptoHasher("sha256").update(body).digest("base64")}'`);
  const csp = SECURITY_HEADERS["content-security-policy"].replace(" 'sha256-{headInline}'", hashes.length ? ` ${hashes.join(" ")}` : "");
  return { ...SECURITY_HEADERS, "content-security-policy": csp };
}

/** Handler for GET/HEAD of web paths; null when the path is not a web asset (the caller answers 404). */
export function createStaticHandler(assets: WebAssets): (req: Request, url: URL) => Response | null {
  return (req, url) => {
    if (req.method !== "GET" && req.method !== "HEAD") return null;
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    let asset = assets.get(path);
    // SPA routes (`/doc`, `/ws/…`) get the shell; anything with an extension must exist
    if (!asset && !/\.[a-z0-9]+$/i.test(path)) {
      path = "/index.html";
      asset = assets.get(path);
    }
    if (!asset) return null;
    const enc = negotiate(req.headers.get("accept-encoding"), { br: !!asset.br, gz: !!asset.gz });
    const body = (enc === "br" ? asset.br : enc === "gzip" ? asset.gz : undefined) ?? asset.raw;
    const headers: Record<string, string> = {
      "content-type": TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream",
      "cache-control": asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
    };
    if (asset.br || asset.gz) headers.vary = "accept-encoding";
    if (enc !== "identity") headers["content-encoding"] = enc;
    return new Response(req.method === "HEAD" ? null : (body as Uint8Array<ArrayBuffer>), { headers });
  };
}
