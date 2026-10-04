// NC-02 (newcomer audit): the first screen never said what the repository IS — `Indexer.profile()` was a stub, so the
// hero had no README sentence, no toolchain / version, no license, no remote; only LOC tiles. The profile is built
// here, 0 tokens, from files the index already knows (README, LICENSE, manifests) and two git config reads.
// CR-PENDING(m1-26): the contract puts it on `Indexer.profile()`; the inputs (fs reads, git remote / describe) are the
// server's, so the composition root computes it after each scan and the indexer override returns it.
import type { AreaStat, FileEntry, GitReader, LineNo, RepoPath, RepoProfile, SourceLang, WorkspaceInfo } from "@mitori/core";

const README_RE = /^readme(\.(md|markdown|rst|txt|adoc))?$/i;
const LICENSE_RE = /^(licen[cs]e|copying)(\.[a-z]+)?$/i;
const README_MAX = 280;

const LICENSES: [RegExp, string][] = [
  [/\bMIT License\b|Permission is hereby granted, free of charge/i, "MIT"],
  [/Apache License,?\s+Version 2\.0/i, "Apache-2.0"],
  [/GNU AFFERO GENERAL PUBLIC LICENSE/i, "AGPL-3.0"],
  [/GNU LESSER GENERAL PUBLIC LICENSE/i, "LGPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 3/i, "GPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 2/i, "GPL-2.0"],
  [/Mozilla Public License,?\s+(v\.|version)\s*2\.0/i, "MPL-2.0"],
  [/Redistribution and use in source and binary forms[\s\S]*Neither the name/i, "BSD-3-Clause"],
  [/Redistribution and use in source and binary forms/i, "BSD-2-Clause"],
  [/The Unlicense|unlicense\.org/i, "Unlicense"],
  [/ISC License/i, "ISC"],
];

/** SPDX id of a license text (first KiB is enough), or null. */
export function spdxOf(text: string): string | null {
  for (const [re, id] of LICENSES) if (re.test(text)) return id;
  return null;
}

/** `git@github.com:o/r.git` / `https://user:tok@github.com/o/r.git` / `ssh://git@host:22/o/r` → `{ host, path }`. */
export function parseRemote(url: string | null): RepoProfile["remote"] {
  if (!url) return null;
  const u = url.trim();
  let host = "";
  let path = "";
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(u);
  const m = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u);
  if (m) {
    host = m[1] as string;
    path = m[2] as string;
  } else if (scp) {
    host = scp[1] as string;
    path = scp[2] as string;
  } else return null;
  path = path.replace(/\.git\/?$/, "").replace(/\/+$/, "");
  if (!host || !path || /[\s<>"]/.test(host + path)) return null;
  return { host: host.toLowerCase(), path };
}

/** A README line that is not prose: heading, badge / image / HTML / link-only line, table, rule, list, quote marker. */
function skippable(line: string): boolean {
  const l = line.trim();
  if (l === "") return true;
  if (/^(#{1,6}\s|={3,}$|-{3,}$|\*{3,}$|_{3,}$|\||<|!\[|\[!\[|```|~~~|\.\. |:)/.test(l)) return true;
  // a line of links / badges only
  if (/^(\[[^\]]*\]\([^)]*\)\s*[|·•-]?\s*)+$/.test(l)) return true;
  if (/^(\[!?\[?[^\]]*\]?\]?\([^)]*\)\s*)+$/.test(l)) return true;
  return false;
}

/** Markdown inline → plain text (links keep their text, emphasis / code ticks dropped). */
function plain(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** First prose paragraph of a README (≤ 280 chars, cut at a sentence end when possible), with its 1-based line. */
export function readmeLede(text: string): { line: LineNo; text: string } | null {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || skippable(raw)) continue;
    // a list item or a quote is prose only when it is the paragraph itself; take its text
    const para: string[] = [];
    let j = i;
    for (; j < lines.length; j++) {
      const l = lines[j] as string;
      if (l.trim() === "" || (j > i && skippable(l))) break;
      para.push(l.replace(/^\s*(>|[-*+]|\d+\.)\s+/, ""));
    }
    const t = plain(para.join(" "));
    if (t.length < 20) continue;
    let out = t;
    if (out.length > README_MAX) {
      const cut = out.slice(0, README_MAX);
      const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "), cut.lastIndexOf("！"), cut.lastIndexOf("? "));
      out = end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, README_MAX - 1)}…`;
    }
    return { line: (i + 1) as LineNo, text: out };
  }
  return null;
}

type Toolchain = NonNullable<RepoProfile["toolchain"]>;

/** Declared toolchain of the primary language from one manifest's text. */
export function toolchainOf(path: RepoPath, text: string, primary: SourceLang | null): Toolchain | null {
  const at = (re: RegExp): { m: RegExpExecArray; line: LineNo } | null => {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i] as string);
      if (m) return { m, line: (i + 1) as LineNo };
    }
    return null;
  };
  const base = path.split("/").pop() ?? path;
  if (base === "go.mod") {
    const r = at(/^toolchain\s+go(\S+)/) ?? at(/^go\s+(\S+)/);
    return r ? { name: "go", version: r.m[1] as string, path, line: r.line } : null;
  }
  if (base === "package.json") {
    try {
      const j = JSON.parse(text) as { engines?: { node?: unknown; bun?: unknown; deno?: unknown }; devDependencies?: Record<string, unknown> };
      for (const name of ["node", "bun", "deno"] as const) {
        const v = j.engines?.[name];
        if (typeof v === "string" && v.trim()) {
          const r = at(new RegExp(`"${name}"\\s*:`));
          return { name, version: v.trim(), path, line: (r?.line ?? 1) as LineNo };
        }
      }
      const ts = j.devDependencies?.typescript;
      if ((primary === "typescript" || primary === "tsx") && typeof ts === "string") {
        const r = at(/"typescript"\s*:/);
        return { name: "typescript", version: ts, path, line: (r?.line ?? 1) as LineNo };
      }
    } catch {
      return null;
    }
    return null;
  }
  if (base === ".nvmrc" || base === ".node-version") {
    const v = text.trim().split(/\s+/)[0];
    return v ? { name: "node", version: v.replace(/^v/, ""), path, line: 1 as LineNo } : null;
  }
  if (base === "pyproject.toml") {
    const r = at(/^\s*requires-python\s*=\s*["']([^"']+)["']/);
    return r ? { name: "python", version: r.m[1] as string, path, line: r.line } : null;
  }
  if (base === "Cargo.toml") {
    const r = at(/^\s*rust-version\s*=\s*["']([^"']+)["']/);
    return r ? { name: "rust", version: r.m[1] as string, path, line: r.line } : null;
  }
  if (base === "rust-toolchain" || base === "rust-toolchain.toml") {
    const r = at(/channel\s*=\s*["']([^"']+)["']/) ?? at(/^(\d+\.\d+(?:\.\d+)?|stable|nightly)\s*$/);
    return r ? { name: "rust", version: r.m[1] as string, path, line: r.line } : null;
  }
  return null;
}

/** Manifests to look at for a primary language, most specific first (root only). */
function manifestsFor(primary: SourceLang | null): string[] {
  switch (primary) {
    case "go":
      return ["go.mod"];
    case "python":
      return ["pyproject.toml"];
    case "rust":
      return ["rust-toolchain.toml", "rust-toolchain", "Cargo.toml"];
    case "typescript":
    case "tsx":
    case "javascript":
    case "jsx":
      return ["package.json", ".nvmrc", ".node-version"];
    default:
      return ["go.mod", "package.json", "pyproject.toml", "Cargo.toml"];
  }
}

const TEST_RE = /(^|\/)(tests?|__tests__|spec|testdata)\/|[._-](test|spec)\.[a-z]+$|_test\.go$/;

/** LOC tiles: the largest top-level source directories (≤ 3) and the tests, largest first. */
export function areasOf(files: readonly FileEntry[]): AreaStat[] {
  const src = files.filter((f) => (f.class === "source" || f.class === "test") && f.excluded === undefined && f.lang !== "generic");
  const dirs = new Map<string, { loc: number; files: number; langs: Map<SourceLang, number> }>();
  let tests = { loc: 0, files: 0, langs: new Map<SourceLang, number>() };
  for (const f of src) {
    const lang = f.lang as SourceLang;
    const into =
      f.class === "test" || TEST_RE.test(f.path)
        ? tests
        : (() => {
            const top = f.path.includes("/") ? `${f.path.split("/")[0]}/` : "./";
            let d = dirs.get(top);
            if (!d) {
              d = { loc: 0, files: 0, langs: new Map() };
              dirs.set(top, d);
            }
            return d;
          })();
    into.loc += f.lines;
    into.files++;
    into.langs.set(lang, (into.langs.get(lang) ?? 0) + f.lines);
  }
  const dominant = (m: Map<SourceLang, number>): SourceLang => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "generic";
  const out: AreaStat[] = [...dirs]
    .sort((a, b) => b[1].loc - a[1].loc)
    .slice(0, 3)
    .map(([dir, d]) =>
      dir === "./"
        ? { kind: "code", lang: dominant(d.langs), loc: d.loc, files: d.files }
        : { kind: "dir", dir, lang: dominant(d.langs), loc: d.loc, files: d.files },
    );
  if (tests.files > 0) out.push({ kind: "tests", lang: dominant(tests.langs), loc: tests.loc, files: tests.files });
  tests = { loc: 0, files: 0, langs: new Map() };
  return out.sort((a, b) => b.loc - a.loc).slice(0, 4);
}

export interface ProfileDeps {
  info: WorkspaceInfo;
  files: () => FileEntry[];
  /** Text of a repo file (≤ 64 KiB is plenty), null when unreadable. */
  read: (path: RepoPath) => Promise<string | null>;
  git: Pick<GitReader, "head"> & Partial<Pick<GitReader, "remoteUrl" | "headMeta">>;
}

/** The static repository profile (0 tokens). */
export async function repoProfile(d: ProfileDeps): Promise<RepoProfile> {
  const files = d.files();
  const root = files.filter((f) => !f.path.includes("/"));
  const byLoc = new Map<SourceLang, number>();
  for (const f of files)
    if (f.class === "source" && f.excluded === undefined && f.lang !== "generic")
      byLoc.set(f.lang as SourceLang, (byLoc.get(f.lang as SourceLang) ?? 0) + f.lines);
  const primary = [...byLoc].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const readme = await (async () => {
    const f = root.filter((x) => README_RE.test(x.path)).sort((a, b) => Number(!/\.md$/i.test(a.path)) - Number(!/\.md$/i.test(b.path)))[0];
    if (!f) return null;
    const text = await d.read(f.path);
    const lede = text ? readmeLede(text) : null;
    return lede ? { path: f.path, ...lede } : null;
  })();

  const license = await (async () => {
    for (const f of root.filter((x) => LICENSE_RE.test(x.path)).sort((a, b) => (a.path < b.path ? -1 : 1))) {
      const text = await d.read(f.path);
      const spdx = text ? spdxOf(text.slice(0, 4096)) : null;
      if (spdx) return { spdx, path: f.path };
    }
    const pkg = root.find((x) => x.path === "package.json");
    if (pkg) {
      try {
        const l = (JSON.parse((await d.read(pkg.path)) ?? "{}") as { license?: unknown }).license;
        if (typeof l === "string" && /^[A-Za-z0-9.+-]{2,40}$/.test(l)) return { spdx: l, path: pkg.path };
      } catch {
        // not JSON
      }
    }
    return null;
  })();

  let toolchain: RepoProfile["toolchain"] = null;
  for (const name of manifestsFor(primary)) {
    const f = root.find((x) => x.path === name);
    if (!f) continue;
    const text = await d.read(f.path);
    toolchain = text ? toolchainOf(f.path, text, primary) : null;
    if (toolchain) break;
  }

  const remote = parseRemote((await d.git.remoteUrl?.().catch(() => null)) ?? null);
  const commit = await d.git.head().catch(() => null);
  const meta = commit ? await d.git.headMeta?.().catch(() => null) : null;
  const head = commit && meta ? { commit, date: meta.date, tag: meta.tag } : null;
  return { remote, head, license, toolchain, readme, areas: areasOf(files) };
}
