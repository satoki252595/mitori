/**
 * Static delivery of the embedded web dist (server spec §9, SRV-I-025): precompressed variant negotiation
 * (br > gzip > identity, never compressed on the fly), `immutable` caching for content-hashed files, SPA fallback
 * for extensionless paths, and the CSP with the hashes of the shell's inline scripts (`'sha256-{headInline}'`).
 * Lookups go through the asset map only — no request path ever reaches the filesystem.
 */
import { SECURITY_HEADERS } from "@mitori/core";
import { sha256 } from "../auth/crypto.ts";
import type { ServerDeps } from "../contract.ts";

export type Assets = ServerDeps["assets"];

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
  webmanifest: "application/manifest+json",
};

export type Encoding = "br" | "gzip" | "identity";

/** Best available encoding for `accept-encoding` (q=0 excludes; ties prefer br). */
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

/** `SECURITY_HEADERS` with the CSP placeholder resolved against the shell's inline scripts (dropped when none). */
export function securityHeaders(indexHtml: string): Record<string, string> {
  const hashes = [...indexHtml.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1] ?? "")
    .filter((body) => body.trim() !== "")
    .map((body) => `'sha256-${sha256(body, "base64")}'`);
  const csp = SECURITY_HEADERS["content-security-policy"].replace(" 'sha256-{headInline}'", hashes.length ? ` ${hashes.join(" ")}` : "");
  return { ...SECURITY_HEADERS, "content-security-policy": csp };
}

/** In-app History routes (web `APP_ROUTES`): their last segment may look like a file (`/w/<ws>/code/src/main.ts`). */
const APP_ROUTE_RE = /^\/(?:w\/|settings(?:\/|$))/;

/**
 * GET/HEAD of a web path; null when it is not a web asset. The shell answers `/`, `/auth`, every in-app route
 * and any other extensionless path; a missing file elsewhere (`/assets/*`, `/x.png`) stays a 404.
 */
export function serveStatic(assets: Assets, req: Request, pathname: string): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  let path = pathname === "/" || pathname === "/auth" ? "/index.html" : pathname;
  let asset = assets.get(path);
  if (!asset && (APP_ROUTE_RE.test(path) || !/\.[a-z0-9]+$/i.test(path))) {
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
}
