/**
 * `bun run size`, first half (WP-11a): the binary gate `bin.size` — ≤ 85 MB target, 95 MB limit (testing spec §6,
 * SC-25; decimal MB). Checks every built `dist/mitori-<target>` (the host one must exist: run `bun run build:bin`)
 * and prints what the binary embeds (dist/.build/manifest.json).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const BIN_SIZE = { target: 85e6, limit: 95e6 } as const;

export type SizeVerdict = "ok" | "over-target" | "over-limit";

export function verdict(bytes: number): SizeVerdict {
  return bytes > BIN_SIZE.limit ? "over-limit" : bytes > BIN_SIZE.target ? "over-target" : "ok";
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

interface Manifest {
  web: { source: string; files: number; rawBytes: number; brBytes: number; gzBytes: number; embeddedBytes?: number };
  assets: { id: string; bytes: number; packedBytes: number }[];
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../../../..");
  const dist = join(root, "dist");
  const host = `mitori-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const bins = existsSync(dist) ? readdirSync(dist).filter((f) => /^mitori-(darwin-arm64|linux-x64|windows-x64\.exe)$/.test(f)) : [];
  if (!bins.includes(host)) {
    console.error(`size: dist/${host} is missing — run \`bun run build:bin\` first`);
    process.exit(1);
  }
  let failed = false;
  for (const f of bins.sort()) {
    const bytes = statSync(join(dist, f)).size;
    const v = verdict(bytes);
    failed ||= v === "over-limit";
    console.log(
      `${v === "ok" ? "✓" : v === "over-target" ? "!" : "✗"} bin.size ${f.padEnd(20)} ${mb(bytes)} (target ${mb(BIN_SIZE.target)}, limit ${mb(BIN_SIZE.limit)})`,
    );
  }
  const manifestPath = join(dist, ".build/manifest.json");
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    const pinned = m.assets.reduce((n, a) => n + a.packedBytes, 0);
    // Older build manifests embedded all three variants. New tables reconstruct identity from the shared Brotli file.
    const web = m.web.embeddedBytes ?? m.web.rawBytes + m.web.brBytes + m.web.gzBytes;
    console.log(`  embeds: ${m.assets.length} pinned files ${mb(pinned)} (brotli) · web (${m.web.source}) ${m.web.files} files ${mb(web)} incl. br/gz`);
  }
  process.exit(failed ? 1 : 0);
}
