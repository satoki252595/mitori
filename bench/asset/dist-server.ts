// Serve a web dist directory the way the daemon does (apps/cli/src/daemon/static.ts): br > gzip > identity from the `.br` /
// `.gz` siblings, immutable caching for `/assets/*`, SPA fallback. Used by `size.ts --dist` and by the tests; the real
// daemon is measured through `--url` or the default source-daemon mode.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  wasm: "application/wasm",
  png: "image/png",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** URL paths of every servable file below `dir` (`.br` / `.gz` siblings are variants, not files). */
export function listDist(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !/\.(br|gz)$/.test(e.name)) out.push(`/${relative(dir, p).split("\\").join("/")}`);
    }
  };
  walk(dir);
  return out.sort();
}

/** Encodings the client accepts, best first (`q=0` excludes). */
function accepted(header: string | null): ("br" | "gzip")[] {
  const q = new Map<string, number>();
  for (const part of (header ?? "").split(",")) {
    const [name = "", ...params] = part.trim().toLowerCase().split(";");
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    q.set(name, qp ? Number(qp.slice(2)) || 0 : 1);
  }
  return (["br", "gzip"] as const).filter((e) => (q.get(e) ?? q.get("*") ?? 0) > 0);
}

export interface DistServer {
  url: string;
  stop(): Promise<void>;
}

export function serveDist(dir: string): DistServer {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      let path = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      if (path.includes("..")) return new Response("bad path", { status: 400 });
      if (!existsSync(join(dir, path)) && !/\.[a-z0-9]+$/i.test(path)) path = "/index.html";
      const file = join(dir, path);
      if (!existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
      const headers: Record<string, string> = {
        "content-type": TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream",
        "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      };
      for (const enc of accepted(req.headers.get("accept-encoding"))) {
        const variant = `${file}${enc === "br" ? ".br" : ".gz"}`;
        if (existsSync(variant)) {
          headers["content-encoding"] = enc;
          headers.vary = "accept-encoding";
          return new Response(readFileSync(variant), { headers });
        }
      }
      return new Response(readFileSync(file), { headers });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/`, stop: async () => void (await server.stop(true)) };
}
