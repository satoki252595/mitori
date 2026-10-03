import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { compileArgs } from "./build-bin.ts";
import { type AssetLock, LOCK, precompress, REQUIRED_IDS, sha256Hex, tableSource, verifyLock } from "./gen-assets.ts";
import { ROOT } from "./lib/repo.ts";

const bytes = new TextEncoder().encode("wasm-bytes");
const entry = (id: string, over: Partial<AssetLock["assets"][number]> = {}) => ({
  id,
  path: `node_modules/x/${id}.wasm`,
  package: "x",
  version: "1.0.0",
  bytes: bytes.length,
  sha256: sha256Hex(bytes),
  ...over,
});
const fullLock = (): AssetLock => ({ version: 1, assets: REQUIRED_IDS.map((id) => entry(id)) });

describe("SKEL-U-10 SEC-16 asset lock verification", () => {
  const read = () => bytes;
  const v = () => "1.0.0";

  test("a matching lock has no problems; the committed lock matches node_modules", () => {
    expect(verifyLock(fullLock(), read, v)).toEqual([]);
    const committed = JSON.parse(readFileSync(join(ROOT, LOCK), "utf8")) as AssetLock;
    const problems = verifyLock(
      committed,
      (rel) => readFileSync(join(ROOT, rel)),
      (pkg) => (JSON.parse(readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf8")) as { version: string }).version,
    );
    expect(problems).toEqual([]);
  });

  test("sha256, size, version, missing file, duplicates and missing ids are each reported", () => {
    const lock = fullLock();
    lock.assets[0] = { ...(lock.assets[0] as AssetLock["assets"][number]), sha256: "0".repeat(64) };
    lock.assets[1] = { ...(lock.assets[1] as AssetLock["assets"][number]), bytes: 1 };
    lock.assets[2] = { ...(lock.assets[2] as AssetLock["assets"][number]), version: "0.9.0" };
    lock.assets.push(entry("grammar.go"));
    lock.assets = lock.assets.filter((a) => a.id !== "shiki.onig");
    lock.assets.push(entry("extra", { path: "node_modules/x/gone.wasm" }));
    const problems = verifyLock(lock, (rel) => (rel.endsWith("gone.wasm") ? null : bytes), v);
    expect(problems.join("\n")).toMatch(/treesitter\.runtime: sha256 [0-9a-f]{64} ≠ lock 0{64}/);
    expect(problems.join("\n")).toContain("grammar.typescript: node_modules/x/grammar.typescript.wasm is 10 bytes, the lock says 1");
    expect(problems.join("\n")).toContain("grammar.tsx: installed x@1.0.0 but the lock pins 0.9.0");
    expect(problems).toContain("grammar.go: listed twice");
    expect(problems).toContain("shiki.onig: missing from the lock");
    expect(problems.join("\n")).toContain("extra: node_modules/x/gone.wasm is missing");
  });
});

describe("SKEL-U-11 embed table and compile flags", () => {
  test("the table imports every file with type file and maps Workers into /$bunfs", () => {
    const src = tableSource(
      fullLock(),
      { "elk.worker": "dist/.build/pinned/elk.worker.br" },
      { "/index.html": { raw: "dist/.build/web/index.html", br: "dist/.build/web/index.html.br", immutable: false } },
      { parse: "apps/cli/src/build/workers/parse.ts" },
    );
    expect(src).toContain('import a7 from "../../dist/.build/pinned/elk.worker.br" with { type: "file" };');
    expect(src).toContain('from "../../node_modules/x/grammar.go.wasm" with { type: "file" }');
    expect(src).toContain('"/index.html": { raw: a9, br: a10, immutable: false }');
    expect(src).toContain('parse: standalone ? "/$bunfs/root/apps/cli/src/build/workers/parse.js" : new URL("../../apps/cli/src/build/workers/parse.ts"');
    expect(src).toContain(`lock: ${JSON.stringify(fullLock().assets)}`);
  });

  test("compiled binaries never autoload .env / bunfig.toml from the cwd", () => {
    const args = compileArgs("dist/.build/entry.ts", ["w.ts"], "linux-x64", "dist/mitori-linux-x64");
    expect(args).toEqual(
      expect.arrayContaining(["--compile", "--minify", "--target=bun-linux-x64", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig"]),
    );
    expect(args.slice(1, 3)).toEqual(["dist/.build/entry.ts", "w.ts"]);
  });
});

describe("SKEL-U-12 precompression", () => {
  test("br/gz written only when they save ≥ 5 %; hashed /assets are immutable", () => {
    mkdirSync(join(ROOT, "dist"), { recursive: true });
    const dir = mkdtempSync(join(ROOT, "dist/.precompress-test-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "index.html"), `<!doctype html>${"<p>mitori</p>".repeat(200)}`);
      writeFileSync(join(dir, "assets/app-1a2b.js"), "x");
      writeFileSync(join(dir, "assets/logo.png"), new Uint8Array(512));
      const web = precompress(dir);
      expect(Object.keys(web)).toEqual(["/assets/app-1a2b.js", "/assets/logo.png", "/index.html"]);
      expect(web["/index.html"]?.br && web["/index.html"]?.gz).toBeTruthy();
      expect(web["/index.html"]?.immutable).toBe(false);
      expect(brotliDecompressSync(readFileSync(join(ROOT, web["/index.html"]?.br ?? ""))).toString()).toContain("<p>mitori</p>");
      expect(web["/assets/app-1a2b.js"]).toEqual({ raw: expect.stringContaining("assets/app-1a2b.js"), immutable: true });
      expect(web["/assets/logo.png"]?.br).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
