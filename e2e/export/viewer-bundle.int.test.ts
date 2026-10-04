// EXP-I-05 — the viewer bundle that gets embedded (binary, daemon, every export) is the PRODUCTION build within its
// 60 KB gz budget, however gen-assets is started. `bun test` sets NODE_ENV=test and test files rebuild the assets
// (INT-00 / SKEL when the binary is stale, INT-07 always): Vite then resolved Svelte's development runtime and the
// viewer came out at 67.5 KB gz, with asset hashes that differed from `build:bin`'s (regression of that).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = join(import.meta.dir, "../..");
const SEAL = join(ROOT, "dist/.build/web/viewer/viewer.json");
const WEB = join(ROOT, "dist/.build/web.json");

interface Seal {
  js: string;
  css: string;
  jsSha256: string;
  jsBytes: number;
  jsGzipBytes: number;
}

const gen = (env: Record<string, string | undefined>) => {
  const r = Bun.spawnSync([process.execPath, "scripts/gen-assets.ts"], { cwd: ROOT, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`gen-assets failed:\n${r.stderr.toString()}`);
  const seal = JSON.parse(readFileSync(SEAL, "utf8")) as Seal;
  return { seal, web: readFileSync(WEB, "utf8") };
};

describe("EXP-I-05 the embedded viewer bundle", () => {
  test(
    "gen-assets under NODE_ENV=test builds the same production bundle as under NODE_ENV=production: ≤ 60 KB gz, same hashes",
    () => {
      const asTest = gen({ NODE_ENV: "test" });
      const js = readFileSync(join(ROOT, "dist/.build/web", asTest.seal.js));
      expect(new Bun.CryptoHasher("sha256").update(js).digest("hex")).toBe(asTest.seal.jsSha256);
      expect(gzipSync(js, { level: 9 }).length).toBe(asTest.seal.jsGzipBytes);
      expect(asTest.seal.jsGzipBytes, "viewer JS gzip bytes (budget asset.viewer.js 60 KB)").toBeLessThanOrEqual(60_000);
      const asProd = gen({ NODE_ENV: "production" });
      expect(asProd.seal.jsSha256).toBe(asTest.seal.jsSha256);
      expect(asProd.web).toBe(asTest.web); // every asset of the web dist hashes the same: a process holding web.json stays valid
    },
    { timeout: 60_000 },
  );
});
