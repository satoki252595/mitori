/**
 * Next.js file-system routes (indexer spec §5.2 `route.next-app@1` / `route.next-pages@1`; gen #4a: "no flow seed
 * for a frontend app" — m3e-canvas had none, so §3 「主要な流れ」 had no entry point from the index).
 *
 * - app router: `(src/)?app/…/page.{tsx,jsx,ts,js}` → `GET` (handler: the default export), and
 *   `(src/)?app/…/route.{ts,js,tsx,jsx}` → one route per exported `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS`;
 * - pages router: `(src/)?pages/…` (not `_app` / `_document` / `_error` / `_middleware`) → `GET`, `pages/api/…` → `ANY`.
 *
 * The pattern is the path below `app` / `pages` (route groups `(x)` and parallel slots `@x` dropped, `index` = the
 * directory, `[id]` kept as written); a `_private` folder and intercepting routes (`(.)x`) are no routes. The link
 * keeps a candidate only when the directory above `(src/)app` holds a `package.json` and its manifest depends on
 * `next` (a `components/pages/` folder of an Express app is not a router).
 */
import type { LineNo } from "@mitori/core";
import type { FactCandidate, FactExtractInput } from "../contract.ts";
import { candidate } from "./candidate.ts";
import type { Tree } from "./tsq.ts";

const SCRIPT = /\.(tsx|ts|jsx|js|mjs|cjs)$/;
const APP_FILE = /^(page|route)$/;
const PAGES_SKIP = /^_(app|document|error|middleware)$/;
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/** The router root of a path: index of its first `app` / `pages` segment, or -1. */
function rootOf(segs: readonly string[]): number {
  return segs.findIndex((s, i) => (s === "app" || s === "pages") && i < segs.length - 1);
}

/** A file the Next detectors look at (cheap path test for `appliesTo`). */
export function nextRouteFile(path: string): boolean {
  if (!SCRIPT.test(path) || /\.(test|spec|stories|d)\.[a-z]+$/.test(path)) return false;
  const segs = path.split("/");
  const r = rootOf(segs);
  if (r < 0) return false;
  const name = (segs[segs.length - 1] as string).replace(SCRIPT, "");
  return segs[r] === "app" ? APP_FILE.test(name) : !PAGES_SKIP.test(name);
}

/** URL segment of one directory / file name, `null` to drop it, `false` when the file is no route. */
function urlSegment(s: string, appRouter: boolean): string | null | false {
  if (appRouter && /^\(\.{1,3}\)/.test(s)) return false; // intercepting route: the same page again
  if (appRouter && /^\(.*\)$/.test(s)) return null; // route group
  if (appRouter && s.startsWith("@")) return null; // parallel slot
  if (s.startsWith("_")) return false; // private folder
  return s;
}

/** The route pattern of a Next file, its package directory and router, or null. */
export function nextPattern(path: string): { pattern: string; pkgDir: string; router: "app" | "pages"; api: boolean } | null {
  if (!nextRouteFile(path)) return null;
  const segs = path.split("/");
  const r = rootOf(segs);
  const router = segs[r] === "app" ? "app" : "pages";
  const prefix = segs.slice(0, r);
  if (prefix[prefix.length - 1] === "src") prefix.pop();
  const below = segs.slice(r + 1);
  const file = (below.pop() as string).replace(SCRIPT, "");
  if (router === "pages" && file !== "index") below.push(file);
  const url: string[] = [];
  for (const s of below) {
    const u = urlSegment(s, router === "app");
    if (u === false) return null;
    if (u !== null) url.push(u);
  }
  return { pattern: `/${url.join("/")}`, pkgDir: prefix.join("/"), router, api: router === "pages" && url[0] === "api" };
}

const lineAt = (text: string, at: number) => (text.slice(0, at).match(/\n/g)?.length ?? 0) + 1;

/** The name `at` points to is code (an identifier), not text in a comment or string. */
function code(tree: Tree, at: number): boolean {
  const t = tree.rootNode.descendantForIndex(at)?.type ?? "";
  return t === "identifier" || t === "type_identifier" || t === "property_identifier";
}

/** The default export's name and line (`export default function Page()`, `export default Page;`). */
function defaultExport(text: string, tree: Tree): { name: string | null; line: number } | null {
  for (const m of text.matchAll(
    /^export\s+default\s+(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*;?\s*$)?/gm,
  )) {
    const name = m[1] ?? m[2] ?? m[3] ?? null;
    const at = (m.index ?? 0) + m[0].indexOf("default");
    if (tree.rootNode.descendantForIndex(at)?.type !== "default") continue;
    return { name, line: lineAt(text, m.index ?? 0) };
  }
  return null;
}

/** Route candidates of one Next.js file (app router: `route.next-app@1`; pages router: `route.next-pages@1`). */
export function nextRoutes(input: FactExtractInput, tree: Tree, router: "app" | "pages"): FactCandidate[] {
  const p = nextPattern(input.file.path);
  if (p === null || p.router !== router) return [];
  const id = router === "app" ? "route.next-app@1" : "route.next-pages@1";
  const framework = router === "app" ? "next-app" : "next-pages";
  const data = (method: string, handler: string | null) => ({ method, pattern: p.pattern, framework, pkgDir: p.pkgDir, ...(handler ? { handler } : {}) });
  const isRouteFile = router === "app" && /(^|\/)route\.[a-z]+$/.test(input.file.path);
  if (!isRouteFile) {
    const d = defaultExport(input.text, tree);
    if (d === null) return [];
    return [candidate(id, "route", input, d.line as LineNo, data(p.api ? "ANY" : "GET", d.name))];
  }
  const out: FactCandidate[] = [];
  const seen = new Set<string>();
  const re = new RegExp(`^export\\s+(?:(?:async\\s+)?function\\s*\\*?\\s*|(?:const|let|var)\\s+)(${METHODS.join("|")})\\b`, "gm");
  for (const m of input.text.matchAll(re)) {
    const method = m[1] as string;
    const at = (m.index ?? 0) + m[0].lastIndexOf(method);
    if (seen.has(method) || !code(tree, at)) continue;
    seen.add(method);
    out.push(candidate(id, "route", input, lineAt(input.text, m.index ?? 0) as LineNo, data(method, method)));
  }
  // `export { GET, POST }` / `export { handler as GET }`
  for (const m of input.text.matchAll(/^export\s*\{([^}]{1,400})\}/gm))
    for (const part of (m[1] as string).split(",")) {
      const [local, as] = part.trim().split(/\s+as\s+/);
      const method = (as ?? local ?? "").trim();
      if (!(METHODS as readonly string[]).includes(method) || seen.has(method)) continue;
      seen.add(method);
      out.push(candidate(id, "route", input, lineAt(input.text, m.index ?? 0) as LineNo, data(method, (local ?? method).trim())));
    }
  return out;
}
