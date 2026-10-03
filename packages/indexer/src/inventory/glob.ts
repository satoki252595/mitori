// Fast glob-list matcher for the S0 hot loop. The deny / secret lists are almost entirely of a few shapes
// (`x`, `x/**`, `**/x`, `**/*.ext`, `**/x/**`, `**/a/b`, root-level `.env.*`); those are answered with set lookups and
// string tests, everything else falls back to picomatch (`dot: true`). Semantics equal picomatch's (glob.test.ts).
import picomatch from "picomatch";

const WILD = /[*?[\]{}()!+@]/;

const toSegRe = (seg: string): string =>
  seg
    .replace(/[.+^$|\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");

/** A compiled list of globs. */
export interface CompiledGlobs {
  test(path: string): boolean;
}

export function compileGlobs(globs: readonly string[]): CompiledGlobs {
  const exact = new Set<string>();
  const base = new Set<string>();
  const baseRes: string[] = [];
  const prefixes = new Map<string, string[]>(); // first segment → full literal prefixes
  const segments = new Set<string>();
  const tails: string[] = [];
  const rootRes: string[] = [];
  const fallback: RegExp[] = [];
  for (const raw of globs) {
    const g = raw.startsWith("./") ? raw.slice(2) : raw;
    const segs = g.split("/");
    const literal = (s: string) => !WILD.test(s);
    if (literal(g)) {
      exact.add(g);
      continue;
    }
    if (segs.length >= 2 && segs[segs.length - 1] === "**" && segs.slice(0, -1).every(literal)) {
      const p = segs.slice(0, -1).join("/");
      const first = segs[0] as string;
      prefixes.set(first, [...(prefixes.get(first) ?? []), p]);
      continue;
    }
    if (segs[0] === "**" && segs.length === 2) {
      const s = segs[1] as string;
      if (s === "**") {
        fallback.push(picomatch.makeRe(g, { dot: true }));
        continue;
      }
      if (literal(s)) base.add(s);
      else if (!/[[\]{}()!+@]/.test(s)) baseRes.push(toSegRe(s));
      else fallback.push(picomatch.makeRe(g, { dot: true }));
      continue;
    }
    if (segs[0] === "**" && segs.length === 3 && segs[2] === "**" && literal(segs[1] as string)) {
      segments.add(segs[1] as string);
      continue;
    }
    if (segs[0] === "**" && segs.length > 2 && segs.slice(1).every(literal)) {
      tails.push(segs.slice(1).join("/"));
      continue;
    }
    if (segs.length === 1 && !g.includes("**") && !/[[\]{}()!+@]/.test(g)) {
      rootRes.push(toSegRe(g));
      continue;
    }
    fallback.push(picomatch.makeRe(g, { dot: true }));
  }
  const baseRe = baseRes.length === 0 ? null : new RegExp(`^(?:${baseRes.join("|")})$`);
  const rootRe = rootRes.length === 0 ? null : new RegExp(`^(?:${rootRes.join("|")})$`);
  const fb = fallback.length === 0 ? null : new RegExp(fallback.map((r) => r.source).join("|"));
  return {
    test(path: string): boolean {
      if (exact.has(path)) return true;
      const slash = path.lastIndexOf("/");
      const b = slash < 0 ? path : path.slice(slash + 1);
      if (base.has(b)) return true;
      if (baseRe?.test(b)) return true;
      if (prefixes.size > 0) {
        const i = path.indexOf("/");
        const list = prefixes.get(i < 0 ? path : path.slice(0, i));
        if (list !== undefined) for (const p of list) if (path === p || path.startsWith(`${p}/`)) return true;
      }
      if (segments.size > 0) {
        let at = 0;
        while (at <= path.length) {
          const j = path.indexOf("/", at);
          const seg = j < 0 ? path.slice(at) : path.slice(at, j);
          if (segments.has(seg)) return true;
          if (j < 0) break;
          at = j + 1;
        }
      }
      for (const t of tails) if (path === t || path.endsWith(`/${t}`)) return true;
      if (rootRe !== null && slash < 0 && rootRe.test(path)) return true;
      return fb?.test(path) === true;
    },
  };
}
