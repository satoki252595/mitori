import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants, gzipSync } from "node:zlib";
import { compileArgs } from "./build-bin.ts";
import {
  type AssetLock,
  LOCK,
  pidAlive,
  precompress,
  publishStagedBuild,
  REQUIRED_IDS,
  reapStaleBuildDirs,
  sha256Hex,
  tableSource,
  verifyLock,
} from "./gen-assets.ts";
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
      { path: "node_modules/.cache/mitori-windows-job/windows-job-x64.exe", sha256: "a".repeat(64), bytes: 59392 },
    );
    expect(src).toContain('import a7 from "../../dist/.build/pinned/elk.worker.br" with { type: "file" };');
    expect(src).toContain('from "../../node_modules/x/grammar.go.wasm" with { type: "file" }');
    expect(src).toContain('"/index.html": { raw: a9, br: a9, immutable: false }');
    expect(src).toContain('process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"');
    expect(src).toContain('parse: standalone ? embeddedRoot + "apps/cli/src/build/workers/parse.js" : new URL("../../apps/cli/src/build/workers/parse.ts"');
    expect(src).toContain(`lock: ${JSON.stringify(fullLock().assets)}`);
    expect(src).toContain('from "../../node_modules/.cache/mitori-windows-job/windows-job-x64.exe" with { type: "file" };');
    expect(src).toContain(`windowsJobLauncher: { path: a10, sha256: "${"a".repeat(64)}", bytes: 59392 }`);
  });

  test("the embedded table keeps gzip and plain fallbacks but imports shared Brotli only once", () => {
    const src = tableSource(
      { version: 1, assets: [] },
      {},
      {
        "/assets/app.js": { raw: "web/app.js", br: "web/app.js.br", gz: "web/app.js.gz", immutable: true },
        "/favicon.ico": { raw: "web/favicon.ico", immutable: false },
      },
      {},
    );
    expect(src).toContain('"/assets/app.js": { raw: a0, br: a0, gz: a1, immutable: true }');
    expect(src.match(/from "\.\.\/\.\.\/web\/app\.js\.br"/g)).toHaveLength(1);
    expect(src).not.toContain('from "../../web/app.js"');
    expect(src).toContain('"/favicon.ico": { raw: a2, immutable: false }');
  });

  test("compiled binaries never autoload .env / bunfig.toml from the cwd", () => {
    const args = compileArgs("dist/.build/entry.ts", ["w.ts"], "linux-x64", "dist/mitori-linux-x64");
    expect(args).toEqual(
      expect.arrayContaining(["--compile", "--minify", "--target=bun-linux-x64", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig"]),
    );
    expect(args.slice(1, 3)).toEqual(["dist/.build/entry.ts", "w.ts"]);
  });
});

describe("WP12 staged publish", () => {
  const scratch = (tag: string) => `dist/.wp12-unit-${process.pid}-${tag}`; // two levels deep, like dist/.build
  const sweep = (out: string) => {
    rmSync(join(ROOT, out), { recursive: true, force: true });
    for (const n of ["tmp", "prev"])
      for (const suffix of ["", "-0", "-1", "-99"]) rmSync(join(ROOT, `${out}.${n}-${process.pid}${suffix}`), { recursive: true, force: true });
  };

  test("publish swaps a complete stage into place and leaves no sidecars", () => {
    const out = scratch("pub");
    sweep(out);
    try {
      const stage = `${out}.tmp-${process.pid}-0`;
      mkdirSync(join(ROOT, stage, "web/assets"), { recursive: true });
      writeFileSync(join(ROOT, stage, "web/index.html"), "v1");
      publishStagedBuild(out, stage, 0);
      expect(readFileSync(join(ROOT, out, "web/index.html"), "utf8")).toBe("v1");
      const stage2 = `${out}.tmp-${process.pid}-1`;
      mkdirSync(join(ROOT, stage2), { recursive: true });
      writeFileSync(join(ROOT, stage2, "web.json"), "v2");
      publishStagedBuild(out, stage2, 1);
      expect(readFileSync(join(ROOT, out, "web.json"), "utf8")).toBe("v2");
      expect(existsSync(join(ROOT, `${out}.prev-${process.pid}-1`))).toBe(false);
      expect(existsSync(join(ROOT, stage2))).toBe(false);
    } finally {
      sweep(out);
    }
  });

  test("reap removes only dead-pid sidecars and restores a parked tree when out is missing", () => {
    const dead = Bun.spawnSync(["true"]).pid;
    expect(pidAlive(dead)).toBe(false);
    expect(pidAlive(process.pid)).toBe(true);
    const out = scratch("reap");
    sweep(out);
    try {
      mkdirSync(join(ROOT, out), { recursive: true });
      writeFileSync(join(ROOT, out, "keep"), "live-tree");
      const deadTmp = `${out}.tmp-${dead}-0`;
      const deadPrev = `${out}.prev-${dead}-0`;
      const liveTmp = `${out}.tmp-${process.pid}-99`;
      mkdirSync(join(ROOT, deadTmp), { recursive: true });
      mkdirSync(join(ROOT, deadPrev), { recursive: true });
      mkdirSync(join(ROOT, liveTmp), { recursive: true });
      writeFileSync(join(ROOT, liveTmp, "sentinel"), "do-not-touch");
      const r = reapStaleBuildDirs(out);
      expect(existsSync(join(ROOT, deadTmp))).toBe(false);
      expect(existsSync(join(ROOT, deadPrev))).toBe(false);
      expect(readFileSync(join(ROOT, liveTmp, "sentinel"), "utf8")).toBe("do-not-touch");
      expect(readFileSync(join(ROOT, out, "keep"), "utf8")).toBe("live-tree");
      expect(r.restored).toBeNull();
      // a kill between parking and swapping leaves the last good tree aside: it comes back
      const out2 = scratch("restore");
      sweep(out2);
      try {
        const parked = `${out2}.prev-${dead}-0`;
        mkdirSync(join(ROOT, parked), { recursive: true });
        writeFileSync(join(ROOT, parked, "web.json"), "last-good");
        const r2 = reapStaleBuildDirs(out2);
        expect(readFileSync(join(ROOT, out2, "web.json"), "utf8")).toBe("last-good");
        expect(r2.restored).toBe(`${out2}.prev-${dead}-0`);
        expect(existsSync(join(ROOT, parked))).toBe(false);
      } finally {
        sweep(out2);
      }
    } finally {
      sweep(out);
      rmSync(join(ROOT, `${out}.tmp-${process.pid}-99`), { recursive: true, force: true });
    }
  });
});

describe("SKEL-U-12 precompression", () => {
  test("both encodings exist when either saves ≥ 5 %; hashed /assets are immutable", () => {
    mkdirSync(join(ROOT, "dist"), { recursive: true });
    const dir = mkdtempSync(join(ROOT, "dist/.precompress-test-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "index.html"), `<!doctype html>${"<p>mitori</p>".repeat(200)}`);
      writeFileSync(join(dir, "assets/app-1a2b.js"), "x");
      const facade = 'import e from"./ReaderPage-CJPWYKq1.js";export{e as ReaderPage};';
      const raw = Buffer.from(facade);
      expect(brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length).toBeLessThan(raw.length * 0.95);
      expect(gzipSync(raw, { level: 9 }).length).toBeGreaterThanOrEqual(raw.length * 0.95);
      writeFileSync(join(dir, "assets/facade-123.js"), facade);
      writeFileSync(join(dir, "assets/logo.png"), new Uint8Array(512));
      const web = precompress(dir);
      expect(Object.keys(web)).toEqual(["/assets/app-1a2b.js", "/assets/facade-123.js", "/assets/logo.png", "/index.html"]);
      expect(web["/assets/facade-123.js"]?.br && web["/assets/facade-123.js"]?.gz).toBeTruthy();
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
