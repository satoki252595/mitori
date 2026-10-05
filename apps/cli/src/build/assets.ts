/**
 * Embedded-asset registry (WP-11a). Inside the compiled binary the generated entry (`dist/.build/assets.gen.ts`,
 * written by `scripts/gen-assets.ts`) calls {@link registerAssets} before `main` runs, so every path below points
 * into `/$bunfs/`; the pinned files are embedded brotli-packed (`*.br`, 7.3 MB → 0.9 MB) and unpacked on read. From a
 * source checkout (`bun apps/cli/src/main.ts`, unit tests) the table falls back to the files on disk: the pinned
 * node_modules files and the last web build in `dist/.build/web`.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import type { InitialUiRenderer } from "@mitori/core";
import type { ServerDeps } from "@mitori/server";

/** `parse` / `compute`: skeleton probes (`_selftest`); `serverParse` / `serverCompute`: the daemon's Workers (WP-INT). */
export type WorkerName = "parse" | "compute" | "serverParse" | "serverCompute";

/** One served web file and its precompressed variants. In an embedded table, raw===br shares the Brotli file;
 * loadWebAssets restores identity bytes. Checkout raw always points to the uncompressed file. */
export interface WebAssetPaths {
  raw: string;
  br?: string;
  gz?: string;
  immutable: boolean;
}

export interface AssetTable {
  /** Canonical server renderer, bundled from the same UI sources at release build time. */
  uiRenderer?: InitialUiRenderer;
  /** `embedded` = registered by the generated entry (compiled binary); `dev` = source checkout. */
  source: "embedded" | "dev";
  /** `assets.lock.json` entries the files were verified against at build time (dev: read from disk). */
  lock: readonly LockEntry[];
  /** Pinned files by `assets.lock.json` id (wasm, grammars, ELK worker) → path; a `.br` path is brotli-packed. */
  files: Readonly<Record<string, string>>;
  /** URL path (`/index.html`, `/assets/…`) → file paths. */
  web: Readonly<Record<string, WebAssetPaths>>;
  /** Worker entry specifiers for `new Worker(spec)`. */
  workers: Readonly<Record<WorkerName, string>>;
  /** Trusted native Windows Job Object launcher, bound to the bytes embedded at build time. */
  windowsJobLauncher?: { path: string; sha256: string; bytes: number };
}

export interface LockEntry {
  id: string;
  /** Repo-relative source path. */
  path: string;
  package: string;
  version: string;
  bytes: number;
  sha256: string;
}

/** Grammar ids the parse Worker loads (`grammar.<lang>`), in the indexer's SourceLang naming. */
export const GRAMMAR_LANGS = ["typescript", "tsx", "javascript", "python", "go", "rust"] as const;

/** Repo-relative manifest of the last web build (written by gen-assets; read only from a source checkout). */
export const DEV_WEB_MANIFEST = "dist/.build/web.json";

let table: AssetTable | null = null;

export function registerAssets(t: Omit<AssetTable, "source">): void {
  table = { source: "embedded", ...t };
}

export function assetTable(): AssetTable {
  // The registered binary is immutable; a checkout can rebuild its manifest between daemon starts.
  return table ?? devTable();
}

function devTable(): AssetTable {
  const repo = new URL("../../../../", import.meta.url);
  const abs = (rel: string) => fileURLToPath(new URL(rel, repo));
  const lock = (JSON.parse(readFileSync(new URL("./assets.lock.json", import.meta.url), "utf8")) as { assets: LockEntry[] }).assets;
  const files = Object.fromEntries(lock.map((a) => [a.id, abs(a.path)]));
  const manifest = abs(DEV_WEB_MANIFEST);
  const nativeManifest = abs("dist/.build/windows-job.json");
  const windowsJobLauncher = existsSync(nativeManifest)
    ? (JSON.parse(readFileSync(nativeManifest, "utf8")) as { path: string; sha256: string; bytes: number })
    : undefined;
  const web: Record<string, WebAssetPaths> = {};
  if (existsSync(manifest)) {
    const rel = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, WebAssetPaths>;
    for (const [url, v] of Object.entries(rel)) {
      const out: WebAssetPaths = { raw: abs(v.raw), immutable: v.immutable };
      if (v.br) out.br = abs(v.br);
      if (v.gz) out.gz = abs(v.gz);
      web[url] = out;
    }
  }
  const worker = (name: string) => new URL(`./workers/${name}.ts`, import.meta.url).href;
  const server = (name: string) => new URL(`../../../../packages/server/src/workers/${name}.ts`, import.meta.url).href;
  return {
    source: "dev",
    lock,
    files,
    web,
    workers: { parse: worker("parse"), compute: worker("compute"), serverParse: server("parse"), serverCompute: server("compute") },
    ...(windowsJobLauncher ? { windowsJobLauncher: { ...windowsJobLauncher, path: abs(windowsJobLauncher.path) } } : {}),
  };
}

/** Bytes of a pinned file (unpacked when embedded as `.br`). */
export async function readPinned(id: string, t: AssetTable = assetTable()): Promise<Uint8Array> {
  const path = t.files[id];
  if (!path) throw new Error(`asset ${id} is not embedded`);
  const bytes = await Bun.file(path).bytes();
  return path.endsWith(".br") ? brotliDecompressSync(bytes) : bytes;
}

/** A `new Worker(url)`-loadable URL of a pinned script: its path, or a Blob URL of the unpacked bytes. */
export async function pinnedScriptUrl(id: string, t: AssetTable = assetTable()): Promise<string> {
  const path = t.files[id];
  if (path && !path.endsWith(".br")) return path;
  return URL.createObjectURL(new Blob([(await readPinned(id, t)) as Uint8Array<ArrayBuffer>], { type: "text/javascript" }));
}

export type WebAssets = ServerDeps["assets"];

const PLACEHOLDER = `<!doctype html><html lang="en"><meta charset="utf-8"><title>mitori</title>
<p>mitori: the web shell is not built in this checkout — run <code>bun scripts/gen-assets.ts</code>.</p></html>`;

/** Read every web file into memory (the dist is small; the server answers from RAM). */
export async function loadWebAssets(t: AssetTable = assetTable()): Promise<WebAssets> {
  const read = (p: string) => Bun.file(p).bytes();
  const entries = await Promise.all(
    Object.entries(t.web).map(async ([url, v]) => {
      const stored = read(v.raw);
      const [bytes, br, gz] = await Promise.all([stored, v.br ? (v.br === v.raw ? stored : read(v.br)) : null, v.gz ? read(v.gz) : null]);
      const raw = t.source === "embedded" && v.raw === v.br ? brotliDecompressSync(bytes) : bytes;
      const a: { raw: Uint8Array; br?: Uint8Array; gz?: Uint8Array; immutable: boolean } = { raw, immutable: v.immutable };
      if (br) a.br = br;
      if (gz) a.gz = gz;
      return [url, a] as const;
    }),
  );
  const map = new Map(entries);
  if (!map.has("/index.html")) map.set("/index.html", { raw: new TextEncoder().encode(PLACEHOLDER), immutable: false });
  return map;
}

/** Release: registered code embedded by Bun. Checkout: only the generated, local server module is loaded. */
export async function loadInitialUiRenderer(t: AssetTable = assetTable()): Promise<InitialUiRenderer | undefined> {
  if (t.uiRenderer) return t.uiRenderer;
  if (t.source !== "dev") return undefined;
  const url = new URL("../../../../dist/.build/initial/initial.js", import.meta.url);
  if (!existsSync(fileURLToPath(url))) return undefined;
  return (await import(url.href)).renderInitialUi as InitialUiRenderer;
}
