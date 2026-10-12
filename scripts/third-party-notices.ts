// `bun scripts/third-party-notices.ts [--check]` (owner: WP-20) — regenerates THIRD_PARTY_NOTICES.md.
// Lists the production dependencies bundled into the binary (`scripts/build-bin.ts`, entry apps/cli) and the
// screen assets (`scripts/gen-assets.ts`, build apps/web): starting from those two packages' `dependencies`, it
// follows workspace and node_modules manifests through `dependencies` only (devDependencies never ship), takes the
// version from the installed package.json, confirms `bun.lock` pins that same version, and reads the license and
// source from the installed package.json. `--check` fails when the file is stale (a changed dependency fails it).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.ts";

export const NOTICES_PATH = "THIRD_PARTY_NOTICES.md";
const LOCK_PATH = "bun.lock";
/** The two shipped surfaces. */
const ROOTS = ["apps/cli/package.json", "apps/web/package.json"] as const;
/** Workspace manifests that may appear along the way (`@mitori/*` itself is not third-party). */
const WORKSPACE_DIRS = ["packages", "apps"] as const;
/** elkjs is dual-licensed; the binary and the screen bundle it under this choice. */
export const ELK_CHOICE = "EPL-2.0";
const ELK_SOURCE = "https://github.com/kieler/elkjs";

export interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
}

export interface Installed {
  version: string;
  license?: unknown;
  licenses?: unknown;
  repository?: unknown;
  homepage?: string;
  dependencies?: Record<string, string>;
}

export interface Notice {
  name: string;
  version: string;
  license: string;
  source: string;
}

/** SPDX-ish text out of the shapes npm allows (`"MIT"`, `{ type }`, `[{ type }]`). */
export function normalizeLicense(pkg: Pick<Installed, "license" | "licenses">): string {
  const raw = pkg.license ?? pkg.licenses;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((e) => (typeof e === "string" ? e : ((e as { type?: string }).type ?? "?"))).join(" OR ");
  if (typeof raw === "object" && raw !== null) return (raw as { type?: string }).type ?? "?";
  return "UNKNOWN";
}

/** Where to get the source: repository URL first, then the homepage. */
export function sourceOf(pkg: Pick<Installed, "repository" | "homepage">): string {
  const repo = pkg.repository;
  if (typeof repo === "string") return repo;
  if (typeof repo === "object" && repo !== null && typeof (repo as { url?: unknown }).url === "string") return (repo as { url: string }).url;
  return pkg.homepage ?? "";
}

export interface Graph {
  manifests: Map<string, Manifest>;
  installed: Map<string, Installed>;
  locked: Set<string>;
}

/** Third-party closure over `dependencies` (workspace packages expand, `@mitori/*` itself is not third-party). */
export function collectNotices(graph: Graph, roots: readonly string[]): Notice[] {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const name of roots) {
    if (!seen.has(name)) {
      seen.add(name);
      queue.push(name);
    }
  }
  const thirdParty = new Map<string, Notice>();
  while (queue.length > 0) {
    const name = queue.pop() as string;
    const manifest = graph.manifests.get(name);
    if (manifest) {
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        if (!seen.has(dep)) {
          seen.add(dep);
          queue.push(dep);
        }
      }
      continue;
    }
    const pkg = graph.installed.get(name);
    if (!pkg) throw new Error(`third-party-notices: ${name} is not installed (bun install --frozen-lockfile?)`);
    if (!graph.locked.has(`${name}@${pkg.version}`)) throw new Error(`third-party-notices: ${name}@${pkg.version} is not in ${LOCK_PATH}`);
    thirdParty.set(name, { name, version: pkg.version, license: normalizeLicense(pkg), source: sourceOf(pkg) });
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...thirdParty.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function countByLicense(notices: readonly Notice[]): [license: string, count: number][] {
  const counts = new Map<string, number>();
  for (const n of notices) counts.set(n.license, (counts.get(n.license) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/** The whole file. No dates or local paths inside, so `--check` only fails on dependency changes. */
export function renderNotices(notices: readonly Notice[]): string {
  const out: string[] = [
    "# Third-party notices",
    "",
    "mitori は MIT（ルートの LICENSE）で公開する。配布バイナリ（`scripts/build-bin.ts`）と画面のアセット",
    "（`scripts/gen-assets.ts`）に同梱される本番依存の一覧が下の表である。devDependencies は同梱されない。",
    "",
    "このファイルは手で直さない。`bun scripts/third-party-notices.ts` が `bun.lock`・各 `package.json`・",
    "`node_modules` の `package.json` から作り直す。`--check` は古くなっていないかを確かめる。",
    "",
    `## 同梱の選択: elkjs は ${ELK_CHOICE}`,
    "",
    "`elkjs` は `EPL-2.0 OR GPL-3.0-or-later` の二択で、mitori は EPL-2.0 を選んで同梱する（GPL 側の条件は",
    `受けない）。入手先は ${ELK_SOURCE} で、条文は https://www.eclipse.org/legal/epl-2.0/ にある。`,
    "MPL-2.0・LGPL・GPL の依存は同梱されない（下の表に無い）。",
    "",
    "| 名前 | 版 | ライセンス | 配布元 |",
    "| --- | --- | --- | --- |",
    ...notices.map((n) => `| ${n.name} | ${n.version} | ${n.license} | ${n.source} |`),
    "",
  ];
  return `${out.join("\n")}`;
}

/** Row-level differences of the table (what `--check` reports before failing). */
export function diffNotices(expected: readonly Notice[], actual: readonly Notice[]): string[] {
  const problems: string[] = [];
  const byName = new Map(actual.map((n) => [n.name, n]));
  for (const n of expected) {
    const got = byName.get(n.name);
    if (!got) problems.push(`${n.name}: missing from ${NOTICES_PATH}`);
    else if (got.version !== n.version || got.license !== n.license || got.source !== n.source)
      problems.push(`${n.name}: ${got.version} ${got.license} ≠ ${n.version} ${n.license}`);
    byName.delete(n.name);
  }
  for (const extra of byName.values()) problems.push(`${extra.name}: not a bundled dependency anymore`);
  return problems;
}

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as unknown;
}

function buildGraph(): { graph: Graph; roots: string[] } {
  const manifests = new Map<string, Manifest>();
  for (const dir of WORKSPACE_DIRS) {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}/package.json`;
      if (!existsSync(join(ROOT, rel))) continue;
      const m = readJson(rel) as Manifest;
      manifests.set(m.name, m);
    }
  }
  const lock = Bun.JSONC.parse(readFileSync(join(ROOT, LOCK_PATH), "utf8")) as { packages: Record<string, unknown> };
  // Values are `[<name@version>, registry, deps, hash]` tuples (keys may carry a `/path` suffix for nesting).
  const locked = new Set(
    Object.values(lock.packages ?? {})
      .map((v) => (Array.isArray(v) && typeof v[0] === "string" ? (v[0] as string).split(",")[0] : null))
      .filter((v): v is string => v !== null),
  );
  const cache = new Map<string, Installed>();
  const installed: Map<string, Installed> = {
    get: (name: string) => {
      const hit = cache.get(name);
      if (hit) return hit;
      const p = join(ROOT, "node_modules", name, "package.json");
      if (!existsSync(p)) return undefined;
      const pkg = JSON.parse(readFileSync(p, "utf8")) as Installed;
      cache.set(name, pkg);
      return pkg;
    },
    has: (name: string) => (installed.get(name) ?? undefined) !== undefined,
  } as unknown as Map<string, Installed>;
  const roots: string[] = [];
  for (const rel of ROOTS) {
    const m = readJson(rel) as Manifest;
    roots.push(...Object.keys(m.dependencies ?? {}));
  }
  return { graph: { manifests, installed, locked }, roots };
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const { graph, roots } = buildGraph();
  let notices: Notice[];
  try {
    notices = collectNotices(graph, roots);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const expected = renderNotices(notices);
  const file = join(ROOT, NOTICES_PATH);
  if (check) {
    const actual = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (actual === expected) {
      console.log(`third-party-notices: ok (${notices.length} dependencies)`);
    } else {
      console.error(`third-party-notices: ${NOTICES_PATH} is stale — run bun scripts/third-party-notices.ts`);
      process.exit(1);
    }
  } else {
    writeFileSync(file, expected);
    console.log(`third-party-notices: wrote ${NOTICES_PATH} (${notices.length} dependencies)`);
  }
}
