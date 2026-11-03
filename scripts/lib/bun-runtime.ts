// Official Bun runtime for `bun build --compile` (WP37c): when the build host and the target
// match, `bun build` reuses the running bun — under Nix that bun is patched to a `/nix/store`
// interpreter, so the output cannot start outside Nix. Host builds therefore compile against an
// official runtime fetched from the same GitHub release the cross-compile path downloads from
// (URL shape verified in the bun 1.4.2 binary strings), cached under node_modules/.cache like
// the asset packs. No network in the sandbox: fetching is covered by unit tests of the pure
// parts plus the exit check; the host re-verifies with a real download.
// Hash pinning (WP37d): every release zip is pinned by sha256 below (from SHASUMS256.txt) and
// verified after download and on every cache hit; the extracted executable passes the
// standalone check before it is used.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { ROOT } from "./repo.ts";
import { checkBinaryNixFree } from "./standalone-check.ts";

export const RUNTIME_CACHE = "node_modules/.cache/mitori-bun-runtime";
const RELEASE_BASE = "https://github.com/oven-sh/bun/releases/download";

/** Pinned sha256 of the official release zips (oven-sh/bun `SHASUMS256.txt`, bun-v1.4.2). Bun bump =
 *  replace these three rows from the new release's SHASUMS256.txt; anything without a row fails closed. */
export const OFFICIAL_RUNTIME_SHA256: Record<string, Record<string, string>> = {
  "1.4.2": {
    "bun-darwin-aarch64.zip": "90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f",
    "bun-linux-aarch64.zip": "54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7",
    "bun-linux-x64.zip": "36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913",
  },
};

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** `bun build --target=bun-<t>` names use arm64; the release assets use aarch64. */
export function officialRuntimeAsset(target: string): string {
  if (target === "linux-x64") return "bun-linux-x64";
  if (target === "linux-arm64") return "bun-linux-aarch64";
  if (target === "darwin-arm64") return "bun-darwin-aarch64";
  if (target === "windows-x64") return "bun-windows-x64";
  throw new Error(`build:bin: unsupported target ${target}`);
}

/** Pinned sha256 for one release zip; anything without a row fails closed (no fetch). */
export function officialRuntimeSha256(version: string, target: string): string {
  const asset = `${officialRuntimeAsset(target)}.zip`;
  const pinned = OFFICIAL_RUNTIME_SHA256[version]?.[asset];
  if (!pinned)
    throw new Error(
      `build:bin: no pinned sha256 for the official Bun ${version} runtime ${asset} (fail-closed: update OFFICIAL_RUNTIME_SHA256 from SHASUMS256.txt)`,
    );
  return pinned;
}

/** Throw unless `zip` hashes to `expectedHex`. */
export function verifyZipSha256(zip: Uint8Array, expectedHex: string): void {
  const actual = sha256Hex(zip);
  if (actual !== expectedHex) throw new Error(`build:bin: sha256 mismatch for the official Bun runtime zip (got ${actual}, want ${expectedHex})`);
}

/** Throw unless `zip` matches the pinned hash for `version`/`target`. */
export function verifyOfficialRuntimeZip(zip: Uint8Array, version: string, target: string): void {
  verifyZipSha256(zip, officialRuntimeSha256(version, target));
}

/** Verify a cached zip file; on mismatch delete it and throw (never refetch automatically). */
export function verifyCachedZipFile(zipPath: string, expectedHex: string): void {
  try {
    verifyZipSha256(readFileSync(zipPath), expectedHex);
  } catch (err) {
    rmSync(zipPath, { force: true });
    throw err;
  }
}

/** Throw unless the extracted runtime passes the standalone check (Windows is out of scope). */
export function verifyExtractedRuntime(exe: Uint8Array, target: string): void {
  const problems = checkBinaryNixFree(exe, target);
  if (problems.length > 0) throw new Error(`build:bin: extracted official Bun runtime fails the standalone check:\n  ${problems.join("\n  ")}`);
}

/** Download candidates for the official runtime (pinned to the running Bun version). */
export function officialRuntimeUrls(version: string, target: string): string[] {
  officialRuntimeSha256(version, target); // fail-closed: no pin, no fetch
  return [`${RELEASE_BASE}/bun-v${version}/${officialRuntimeAsset(target)}.zip`];
}

/** Repo-relative path of the cached official runtime executable. */
export function runtimeCachePath(version: string, target: string): string {
  return `${RUNTIME_CACHE}/bun-${version}-${target}/${target.startsWith("windows-") ? "bun.exe" : "bun"}`;
}

/** Repo-relative path of the cached official runtime zip (next to the extracted executable). */
export function runtimeCacheZipPath(version: string, target: string): string {
  return `${RUNTIME_CACHE}/bun-${version}-${target}/${officialRuntimeAsset(target)}.zip`;
}

/** The `TARGETS` name of this host (`darwin-arm64`, `linux-x64`, …). */
export function hostTarget(): string {
  return `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
}

/** True when the running bun itself would bake a `/nix/store` dependency into a host build. */
export function currentBunIsNixTainted(target = hostTarget()): boolean {
  return checkBinaryNixFree(readFileSync(process.execPath), target).length > 0;
}

const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u16 = (v: DataView, o: number) => v.getUint16(o, true);

/** Pull the `bun` executable out of a release zip (stored or deflated entries). */
export function extractBunFromZip(zip: Uint8Array): Uint8Array {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let o = zip.length - 22; o >= Math.max(0, zip.length - 65557); o--) {
    if (u32(v, o) === 0x06054b50) {
      eocd = o;
      break;
    }
  }
  if (eocd < 0) throw new Error("build:bin: not a zip archive (official Bun runtime)");
  const count = u16(v, eocd + 10);
  let dir = u32(v, eocd + 16);
  for (let i = 0; i < count; i++) {
    if (u32(v, dir) !== 0x02014b50) throw new Error("build:bin: bad zip central directory (official Bun runtime)");
    const method = u16(v, dir + 10);
    const compSize = u32(v, dir + 24);
    const nameLen = u16(v, dir + 28);
    const extraLen = u16(v, dir + 30);
    const commentLen = u16(v, dir + 32);
    const localOff = u32(v, dir + 42);
    const name = new TextDecoder().decode(zip.subarray(dir + 46, dir + 46 + nameLen));
    dir += 46 + nameLen + extraLen + commentLen;
    if (!/(^|\/)bun(\.exe)?$/.test(name)) continue;
    const lhName = u16(v, localOff + 26) + u16(v, localOff + 28);
    const data = zip.subarray(localOff + 30 + lhName, localOff + 30 + lhName + compSize);
    if (method === 0) return Uint8Array.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`build:bin: unsupported zip method ${method} for ${name}`);
  }
  throw new Error("build:bin: no bun executable in the official runtime archive");
}

/** Absolute path of a Nix-free runtime for `target` (override, verified cache, then download). */
export async function ensureOfficialRuntime(target: string, version = Bun.version): Promise<string> {
  const override = process.env.MITORI_OFFICIAL_BUN;
  if (override) return override;
  const expected = officialRuntimeSha256(version, target); // fail-closed before cache/network
  const rel = runtimeCachePath(version, target);
  const abs = join(ROOT, rel);
  const zipRel = runtimeCacheZipPath(version, target);
  const zipAbs = join(ROOT, zipRel);
  const materializeExe = (zip: Uint8Array): void => {
    const exe = extractBunFromZip(zip);
    verifyExtractedRuntime(exe, target);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, exe);
    if (!target.startsWith("windows-")) chmodSync(abs, 0o755);
  };
  if (existsSync(zipAbs)) {
    verifyCachedZipFile(zipAbs, expected); // mismatch deletes the zip and throws; no auto refetch
    if (!existsSync(abs)) {
      materializeExe(readFileSync(zipAbs));
    } else {
      try {
        verifyExtractedRuntime(readFileSync(abs), target);
      } catch (err) {
        rmSync(abs, { force: true }); // the zip is verified: re-running re-extracts offline
        throw err;
      }
    }
    console.log(`build:bin: using cached official Bun ${version} runtime for ${target} (${zipRel} verified)`);
    return abs;
  }
  if (existsSync(abs)) {
    // WP37c cached only the executable, which cannot be verified against the pin: drop it fail-closed.
    rmSync(abs, { force: true });
    throw new Error(
      `build:bin: cached official Bun ${version} runtime for ${target} has no verifiable zip (${zipRel}); deleted it — re-run with network to re-fetch.`,
    );
  }
  const urls = officialRuntimeUrls(version, target);
  let last = "";
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        last = `${url}: HTTP ${res.status}`;
        continue;
      }
      const zip = new Uint8Array(await res.arrayBuffer());
      verifyOfficialRuntimeZip(zip, version, target); // mismatch: never cached
      materializeExe(zip);
      mkdirSync(dirname(zipAbs), { recursive: true });
      writeFileSync(zipAbs, zip);
      console.log(`build:bin: cached official Bun ${version} runtime for ${target} (${rel})`);
      return abs;
    } catch (err) {
      last = `${url}: ${err instanceof Error ? err.message : err}`;
    }
  }
  throw new Error(
    `build:bin: cannot fetch the official Bun ${version} runtime for ${target} (offline?) — last error: ${last}. ` +
      `Pre-seed it with MITORI_OFFICIAL_BUN=<official bun> or wait for network.`,
  );
}
