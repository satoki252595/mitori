/**
 * Code fetches for the context column (code mode) and S3 (ux.md §4.4.2 / §4.5): server-highlighted line windows
 * (`GET /files/content?…&html=1`), ±`codePaneCtxLines` around the cited range, LRU-cached; never more than
 * `maxMountedCodeLines` lines mounted.
 */
import type { ApiClient } from "@mitori/client";
import type { FileContent, LineNo, RepoPath, WorkspaceKey } from "@mitori/core";
import { UI_THRESHOLDS } from "../contract.ts";

const cache = new Map<string, Promise<FileContent>>();

export function codeWindow(start: LineNo, end: LineNo, ctx: number = UI_THRESHOLDS.codePaneCtxLines): { start: LineNo; end: LineNo } {
  const s = Math.max(1, start - ctx);
  let e = end + ctx;
  if (e - s + 1 > UI_THRESHOLDS.maxMountedCodeLines) e = s + UI_THRESHOLDS.maxMountedCodeLines - 1;
  return { start: s, end: e };
}

export function loadCode(api: ApiClient, ws: WorkspaceKey, path: RepoPath, start: LineNo, end: LineNo): Promise<FileContent> {
  const key = `${ws}|${path}|${start}-${end}`;
  let p = cache.get(key);
  if (!p) {
    p = api.call("GET /ws/:ws/files/content", { params: { ws }, query: { path, start, end, html: "1" } });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

/** Drop cached windows of changed files (SSE `index.changed`); returns true when one of `paths` was cached. */
export function invalidateCode(ws: WorkspaceKey, paths: readonly RepoPath[]): boolean {
  const changed = new Set(paths);
  let hit = false;
  for (const key of [...cache.keys()]) {
    const [w, p] = key.split("|");
    if (w === ws && p !== undefined && changed.has(p)) {
      cache.delete(key);
      hit = true;
    }
  }
  return hit;
}

/**
 * Editor deep link (ux.md §4.3.6 `⇧O`, §16 R21): `vscode://file/{abs}:{line}` / `cursor://file/{abs}:{line}`. Path
 * segments are percent-encoded (spaces, `#`, `?` in file names would otherwise cut the URL); separators stay.
 */
export function editorUrl(editor: "vscode" | "cursor", root: string, path: RepoPath, line: LineNo): string {
  const abs = `${root.replace(/[\\/]+$/, "")}/${path}`.replaceAll("\\", "/");
  const enc = abs
    .split("/")
    .map((seg) => (/^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join("/");
  return `${editor}://file${enc.startsWith("/") ? "" : "/"}${enc}:${line}`;
}

/** `path:start-end` (a `data-cite` value) → parts. */
export function parseCite(cite: string): { path: RepoPath; start: LineNo; end: LineNo } | null {
  const i = cite.lastIndexOf(":");
  if (i <= 0) return null;
  const m = /^(\d+)(?:-(\d+))?$/.exec(cite.slice(i + 1));
  if (!m) return null;
  const start = Number(m[1]);
  return { path: cite.slice(0, i), start, end: m[2] === undefined ? start : Number(m[2]) };
}
