// Served-bytes measurement of the web shell (testing spec §6.5): GET `/`, read the assets it requests, fetch every asset once
// per encoding and count the response body bytes. Sizes are decimal KB (1 KB = 1000 B), like Vite's report and the budgets.
import { servedBytes } from "@mitori/testkit";
import { extractAssets, type ShellAssets } from "./html.ts";

export type Kind = "js" | "css" | "font" | "other";

export interface AssetRow {
  path: string;
  kind: Kind;
  /** Requested by the shell's HTML on a cold load. */
  initial: boolean;
  /** Response body bytes under `Accept-Encoding: br` / `gzip`. */
  br: number;
  gz: number;
  /** `content-encoding` actually received (null = served uncompressed). */
  brEncoding: string | null;
  gzEncoding: string | null;
  immutable: boolean;
  contentType: string;
  /** The file name carries a content hash. */
  hashed: boolean;
}

export interface Metric {
  /** A budget id from bench/budgets/web.json. */
  id: string;
  value: number;
  unit: "KB" | "B" | "pct";
  detail: string;
}

export interface AssetMeasurement {
  shell: ShellAssets;
  rows: AssetRow[];
  metrics: Metric[];
}

const FONT = /\.(woff2?|ttf|otf|eot)$/i;
const kindOf = (path: string, contentType: string): Kind =>
  /^font\//i.test(contentType) || FONT.test(path) ? "font" : /\.m?js$/i.test(path) ? "js" : /\.css$/i.test(path) ? "css" : "other";

/** `app-3fA9x_Qz.js` → hashed, chunk name `app`. Vite's default hash is 8 base64url characters. */
const HASHED = /^(.+)-([A-Za-z0-9_-]{8})\.[a-z0-9]+$/;
const hashedName = (path: string): boolean => HASHED.test(path.split("/").pop() ?? "") || /\.[0-9a-f]{8,}\.[a-z0-9]+$/.test(path);

/** Chunk name of a JS file under /assets/ (`palette-worker-Ab12Cd34.js` → `palette-worker`; unhashed `cm6.js` → `cm6`). */
export function chunkName(path: string): string | null {
  if (!path.startsWith("/assets/") || !/\.m?js$/i.test(path)) return null;
  const file = (path.split("/").pop() as string).replace(/\.m?js$/i, "");
  const m = /^(.+)-[A-Za-z0-9_-]{8}$/.exec(file);
  return m ? (m[1] as string) : file;
}

const kb = (bytes: number): number => bytes / 1000;
const sum = (rows: readonly AssetRow[], f: (r: AssetRow) => number): number => rows.reduce((s, r) => s + f(r), 0);

/**
 * `listing` = every URL path the server can serve (a dist directory or the daemon's web manifest); without it only what
 * the shell requests is measured, so chunk budgets for lazy chunks are not evaluated.
 */
export async function measureAssets(baseUrl: string, listing: readonly string[] = []): Promise<AssetMeasurement> {
  const html = await (await fetch(baseUrl, { headers: { accept: "text/html" } })).text();
  const shell = extractAssets(html);
  const initial = new Set([...shell.scripts, ...shell.preloads, ...shell.styles, ...shell.fonts]);
  const wanted = new Set<string>(initial);
  for (const p of listing) if (p.startsWith("/assets/") || FONT.test(p)) if (!/\.(map|br|gz)$/.test(p)) wanted.add(p);
  const paths = [...wanted].sort();
  const [br, gz] = paths.length === 0 ? [[], []] : await Promise.all([servedBytes(baseUrl, paths, "br"), servedBytes(baseUrl, paths, "gzip")]);
  const rows: AssetRow[] = paths.map((path, i) => {
    const b = br[i];
    const g = gz[i];
    if (!b || !g) throw new Error(`no response for ${path}`);
    return {
      path,
      kind: kindOf(path, b.contentType),
      initial: initial.has(path),
      br: b.bytes,
      gz: g.bytes,
      brEncoding: b.contentEncoding,
      gzEncoding: g.contentEncoding,
      immutable: b.immutable && g.immutable,
      contentType: b.contentType,
      hashed: hashedName(path),
    };
  });

  const metrics: Metric[] = [];
  const initialJs = rows.filter((r) => r.initial && r.kind === "js");
  metrics.push({
    id: "asset.js.initial.gz",
    value: kb(sum(initialJs, (r) => r.gz)),
    unit: "KB",
    detail: `${initialJs.length} files requested by the shell (static; br ${kb(sum(initialJs, (r) => r.br)).toFixed(1)} KB). Route-specific initial JS is measured by the e2e harness`,
  });
  const css = rows.filter((r) => r.kind === "css" && r.initial);
  metrics.push({
    id: "asset.css.gz",
    value: kb(sum(css, (r) => r.gz)),
    unit: "KB",
    detail: `${css.length} stylesheets (br ${kb(sum(css, (r) => r.br)).toFixed(1)} KB)`,
  });
  const fonts = rows.filter((r) => r.kind === "font");
  metrics.push({
    id: "asset.font",
    value: sum(fonts, (r) => r.gz),
    unit: "B",
    detail: fonts.length ? fonts.map((f) => f.path).join(", ") : "no font response",
  });

  const chunkGz = new Map<string, number>();
  for (const r of rows) {
    const name = chunkName(r.path);
    if (name) chunkGz.set(name, (chunkGz.get(name) ?? 0) + r.gz);
  }
  for (const [name, bytes] of chunkGz) metrics.push({ id: `asset.chunk.${name}`, value: kb(bytes), unit: "KB", detail: "gzip" });
  if (chunkGz.has("cm6") || chunkGz.has("merge")) {
    metrics.push({ id: "asset.chunk.cm6merge", value: kb((chunkGz.get("cm6") ?? 0) + (chunkGz.get("merge") ?? 0)), unit: "KB", detail: "cm6 + merge, gzip" });
  }
  const viewer = chunkGz.get("viewer");
  if (viewer !== undefined) metrics.push({ id: "asset.viewer.js", value: kb(viewer), unit: "KB", detail: "gzip" });

  // §6.5 step 5: every /assets/* of 1 KB or more is precompressed (both encodings), immutable and content-hashed
  const eligible = rows.filter((r) => r.path.startsWith("/assets/") && (r.brEncoding !== null || r.gzEncoding !== null || Math.max(r.br, r.gz) >= 1000));
  const good = eligible.filter((r) => r.brEncoding === "br" && r.gzEncoding === "gzip" && r.immutable && r.hashed);
  const bad = eligible.filter((r) => !good.includes(r));
  metrics.push({
    id: "asset.precompressed",
    value: eligible.length === 0 ? 100 : (100 * good.length) / eligible.length,
    unit: "pct",
    detail: bad.length === 0 ? `${eligible.length} files` : `not precompressed/immutable/hashed: ${bad.map((r) => r.path).join(", ")}`,
  });
  return { shell, rows, metrics };
}
