// `bun scripts/gen-assets.ts [--lock <file>] [--verify-only] [--update-lock]` (owner: WP-11a; build:bin runs it).
// 1. Verifies every pinned file (wasm, grammars, ELK worker) against apps/cli/src/build/assets.lock.json — a sha256 /
//    size / package-version mismatch fails the build (SEC-16) — and brotli-packs it for embedding (7.3 MB → 0.9 MB;
//    the packed bytes are cached by sha256 in node_modules/.cache/mitori-assets/).
// 2. Builds the web dist: WP-10a's apps/web (index.html + vite.config.ts) when present, else the stub shell
//    apps/web/src/__stub. Precompresses it (brotli q11 + gzip 9).
// 3. Writes dist/.build/: pinned/ (*.br), web/ (dist + .br/.gz), web.json (source-checkout fallback), assets.gen.ts
//    (the `import … with { type: "file" }` table), entry.ts (the compile entry) and manifest.json (for `bun run size`).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, brotliCompressSync, brotliDecompressSync, constants, gzipSync } from "node:zlib";
import { ROOT } from "./lib/repo.ts";

export const OUT = "dist/.build";
const PACK_CACHE = "node_modules/.cache/mitori-assets";
export const LOCK = "apps/cli/src/build/assets.lock.json";
/**
 * Worker entrypoints compiled into the binary (name → repo path). `parse` / `compute` are the walking-skeleton probes
 * `mitori _selftest` drives; `serverParse` / `serverCompute` are the daemon's real Workers (WP-INT, CR m0-19).
 */
export const WORKERS = {
  parse: "apps/cli/src/build/workers/parse.ts",
  compute: "apps/cli/src/build/workers/compute.ts",
  serverParse: "packages/server/src/workers/parse.ts",
  serverCompute: "packages/server/src/workers/compute.ts",
} as const;
/** Ids the runtime needs (apps/cli/src/build/assets.ts reads them by name). */
export const REQUIRED_IDS = [
  "treesitter.runtime",
  "grammar.typescript",
  "grammar.tsx",
  "grammar.javascript",
  "grammar.python",
  "grammar.go",
  "grammar.rust",
  "elk.worker",
  "shiki.onig",
] as const;

export interface LockEntry {
  id: string;
  path: string;
  package: string;
  version: string;
  bytes: number;
  sha256: string;
}
export interface AssetLock {
  $comment?: string;
  version: number;
  assets: LockEntry[];
}
export interface WebEntry {
  raw: string;
  br?: string;
  gz?: string;
  immutable: boolean;
}

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Problems of the lock against the installed files (empty = ok). `read` returns null for a missing file. */
export function verifyLock(lock: AssetLock, read: (rel: string) => Uint8Array | null, installedVersion: (pkg: string) => string | null): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const a of lock.assets) {
    if (ids.has(a.id)) problems.push(`${a.id}: listed twice`);
    ids.add(a.id);
    const bytes = read(a.path);
    if (bytes === null) {
      problems.push(`${a.id}: ${a.path} is missing (bun install --frozen-lockfile?)`);
      continue;
    }
    const v = installedVersion(a.package);
    if (v !== a.version) problems.push(`${a.id}: installed ${a.package}@${v ?? "?"} but the lock pins ${a.version}`);
    if (bytes.length !== a.bytes) problems.push(`${a.id}: ${a.path} is ${bytes.length} bytes, the lock says ${a.bytes}`);
    const sha = sha256Hex(bytes);
    if (sha !== a.sha256) problems.push(`${a.id}: sha256 ${sha} ≠ lock ${a.sha256} (${a.path})`);
  }
  for (const id of REQUIRED_IDS) if (!ids.has(id)) problems.push(`${id}: missing from the lock`);
  return problems;
}

const readRel = (rel: string): Uint8Array | null => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel)) : null);
const installedVersion = (pkg: string): string | null => {
  const p = join(ROOT, "node_modules", pkg, "package.json");
  return existsSync(p) ? ((JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? null) : null;
};

/** Re-pin the lock to the installed files (after a deliberate package bump; review the diff). */
export function updatedLock(lock: AssetLock): AssetLock {
  return {
    ...lock,
    assets: lock.assets.map((a) => {
      const bytes = readRel(a.path);
      if (bytes === null) throw new Error(`${a.id}: ${a.path} is missing`);
      return { ...a, version: installedVersion(a.package) ?? a.version, bytes: bytes.length, sha256: sha256Hex(bytes) };
    }),
  };
}

const brotliAsync = promisify(brotliCompress);
const BR_MAX = (size: number) => ({
  params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: size },
});

/** Brotli-pack every pinned file into `<OUT>/pinned/`; returns id → repo-relative packed path. */
export async function packPinned(lock: AssetLock): Promise<Record<string, string>> {
  mkdirSync(join(ROOT, OUT, "pinned"), { recursive: true });
  mkdirSync(join(ROOT, PACK_CACHE), { recursive: true });
  const entries = await Promise.all(
    lock.assets.map(async (a) => {
      const cached = join(ROOT, PACK_CACHE, `${a.sha256}.br`);
      let packed: Uint8Array | null = existsSync(cached) ? readFileSync(cached) : null;
      if (packed && sha256Hex(brotliDecompressSync(packed)) !== a.sha256) packed = null; // corrupt cache entry
      if (!packed) {
        const raw = readFileSync(join(ROOT, a.path));
        if (sha256Hex(raw) !== a.sha256) throw new Error(`${a.id}: ${a.path} changed after verification`);
        packed = await brotliAsync(raw, BR_MAX(raw.length));
        writeFileSync(cached, packed);
      }
      const rel = `${OUT}/pinned/${a.id}.br`; // ids are unique (verifyLock)
      writeFileSync(join(ROOT, rel), packed);
      return [a.id, rel] as const;
    }),
  );
  return Object.fromEntries(entries);
}

const COMPRESSIBLE = /\.(html|js|mjs|css|json|map|svg|txt|xml|wasm)$/i;
/** Keep a variant only when it saves at least 5 %. */
const worthIt = (raw: Uint8Array, packed: Uint8Array) => packed.length < raw.length * 0.95;

/** Write `.br` / `.gz` next to every compressible file under `dir`; returns the URL map (repo-relative paths). */
export function precompress(dir: string): Record<string, WebEntry> {
  const out: Record<string, WebEntry> = {};
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.isFile() ? [join(d, e.name)] : []));
  for (const file of walk(dir).sort()) {
    if (/\.(br|gz)$/.test(file)) continue;
    const url = `/${relative(dir, file).split("\\").join("/")}`;
    const entry: WebEntry = { raw: relative(ROOT, file), immutable: url.startsWith("/assets/") };
    if (COMPRESSIBLE.test(file)) {
      const raw = readFileSync(file);
      const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
      const gz = gzipSync(raw, { level: 9 });
      if (worthIt(raw, br)) {
        writeFileSync(`${file}.br`, br);
        entry.br = `${entry.raw}.br`;
      }
      if (worthIt(raw, gz)) {
        writeFileSync(`${file}.gz`, gz);
        entry.gz = `${entry.raw}.gz`;
      }
    }
    out[url] = entry;
  }
  return out;
}

/** Build the SPA into `outDir`; returns which source was used. */
export async function buildWeb(outDir: string): Promise<"apps/web" | "apps/web/src/__stub"> {
  const { build } = await import("vite");
  const app = existsSync(join(ROOT, "apps/web/index.html")) && existsSync(join(ROOT, "apps/web/vite.config.ts"));
  const common = { logLevel: "warn" as const, base: "/", build: { outDir, emptyOutDir: true, assetsDir: "assets", reportCompressedSize: false } };
  if (app) {
    // the shell compares its build version with the daemon's `hello.version` (reload banner): both are the CLI's
    const version = (JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as { version: string }).version;
    await build({
      ...common,
      define: { __MITORI_VERSION__: JSON.stringify(version) },
      root: join(ROOT, "apps/web"),
      configFile: join(ROOT, "apps/web/vite.config.ts"),
    });
    return "apps/web";
  }
  const { svelte } = await import("@sveltejs/vite-plugin-svelte");
  await build({ ...common, root: join(ROOT, "apps/web/src/__stub"), configFile: false, envDir: false, plugins: [svelte()] });
  return "apps/web/src/__stub";
}

/** Source of dist/.build/assets.gen.ts. All paths are repo-relative; the file sits two levels down. */
export function tableSource(
  lock: AssetLock,
  pinned: Readonly<Record<string, string>>,
  web: Record<string, WebEntry>,
  workers: Readonly<Record<string, string>>,
): string {
  const imports: string[] = [];
  const ref = (repoRel: string) => {
    const name = `a${imports.length}`;
    imports.push(`import ${name} from ${JSON.stringify(`../../${repoRel}`)} with { type: "file" };`);
    return name;
  };
  const files = lock.assets.map((a) => `    ${JSON.stringify(a.id)}: ${ref(pinned[a.id] ?? a.path)},`);
  const webLines = Object.entries(web).map(([url, e]) => {
    const parts = [`raw: ${ref(e.raw)}`];
    if (e.br) parts.push(`br: ${ref(e.br)}`);
    if (e.gz) parts.push(`gz: ${ref(e.gz)}`);
    parts.push(`immutable: ${e.immutable}`);
    return `    ${JSON.stringify(url)}: { ${parts.join(", ")} },`;
  });
  // bun build --compile --root <repo>: each extra entrypoint is embedded at /$bunfs/root/<repo path>.js
  const workerLines = Object.entries(workers).map(
    ([name, src]) =>
      `    ${name}: standalone ? ${JSON.stringify(`/$bunfs/root/${src.replace(/\.ts$/, ".js")}`)} : new URL(${JSON.stringify(`../../${src}`)}, import.meta.url).href,`,
  );
  return [
    "// GENERATED by scripts/gen-assets.ts — do not edit (bun run build:bin rewrites it).",
    'import { registerAssets } from "../../apps/cli/src/build/assets.ts";',
    ...imports,
    "",
    "const standalone = Bun.isStandaloneExecutable;",
    "registerAssets({",
    `  lock: ${JSON.stringify(lock.assets)},`,
    "  files: {",
    ...files,
    "  },",
    "  web: {",
    ...webLines,
    "  },",
    "  workers: {",
    ...workerLines,
    "  },",
    "});",
    "",
  ].join("\n");
}

export const ENTRY_SOURCE = `// GENERATED by scripts/gen-assets.ts — do not edit. The compile entry: register the embedded assets, then run.
import "./assets.gen.ts";
import { main } from "../../apps/cli/src/main.ts";

process.exitCode = await main(process.argv.slice(2));
`;

export interface GenResult {
  entry: string;
  workers: string[];
  web: "apps/web" | "apps/web/src/__stub";
  manifest: Manifest;
}
export interface Manifest {
  web: { source: string; files: number; rawBytes: number; brBytes: number; gzBytes: number };
  assets: { id: string; bytes: number; packedBytes: number }[];
  workers: Record<string, string>;
}

const sizeOf = (rel: string | undefined) => (rel ? readFileSync(join(ROOT, rel)).length : 0);

export async function genAssets(opts: { lock?: string; verifyOnly?: boolean; log?: (s: string) => void } = {}): Promise<GenResult | null> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const lockPath = opts.lock ?? LOCK;
  const lock = JSON.parse(readFileSync(resolve(ROOT, lockPath), "utf8")) as AssetLock;
  const problems = verifyLock(lock, readRel, installedVersion);
  if (problems.length > 0) throw new Error(`asset lock ${lockPath} does not match the installed files (SEC-16):\n  ${problems.join("\n  ")}`);
  log(`gen-assets: ${lock.assets.length} pinned files match ${lockPath}`);
  if (opts.verifyOnly) return null;

  const out = join(ROOT, OUT);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const webDir = join(out, "web");
  const t0 = performance.now();
  const [pinned, source] = await Promise.all([packPinned(lock), buildWeb(webDir)]);
  const web = precompress(webDir);
  const sum = (k: "raw" | "br" | "gz") => Object.values(web).reduce((n, e) => n + sizeOf(e[k]), 0);
  const manifest: Manifest = {
    web: { source, files: Object.keys(web).length, rawBytes: sum("raw"), brBytes: sum("br"), gzBytes: sum("gz") },
    assets: lock.assets.map((a) => ({ id: a.id, bytes: a.bytes, packedBytes: sizeOf(pinned[a.id]) })),
    workers: { ...WORKERS },
  };
  writeFileSync(join(out, "web.json"), `${JSON.stringify(web, null, 2)}\n`);
  writeFileSync(join(out, "assets.gen.ts"), tableSource(lock, pinned, web, WORKERS));
  writeFileSync(join(out, "entry.ts"), ENTRY_SOURCE);
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const packedBytes = manifest.assets.reduce((n, a) => n + a.packedBytes, 0);
  log(`gen-assets: pinned files packed ${(lock.assets.reduce((n, a) => n + a.bytes, 0) / 1e6).toFixed(1)} MB → ${(packedBytes / 1e6).toFixed(2)} MB`);
  log(
    `gen-assets: web from ${source}: ${manifest.web.files} files, ${(manifest.web.rawBytes / 1024).toFixed(1)} KiB raw / ${(manifest.web.brBytes / 1024).toFixed(1)} KiB br (${(performance.now() - t0).toFixed(0)} ms)`,
  );
  return { entry: `${OUT}/entry.ts`, workers: Object.values(WORKERS), web: source, manifest };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const lockArg = argv.includes("--lock") ? argv[argv.indexOf("--lock") + 1] : undefined;
  if (argv.includes("--update-lock")) {
    const path = lockArg ?? LOCK;
    const lock = JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as AssetLock;
    writeFileSync(resolve(ROOT, path), `${JSON.stringify(updatedLock(lock), null, 2)}\n`);
    console.log(`gen-assets: re-pinned ${path} — review the diff before committing`);
  } else {
    try {
      await genAssets({ ...(lockArg ? { lock: lockArg } : {}), verifyOnly: argv.includes("--verify-only") });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
}
