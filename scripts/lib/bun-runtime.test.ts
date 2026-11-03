import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractBunFromZip,
  officialRuntimeAsset,
  officialRuntimeSha256,
  officialRuntimeUrls,
  runtimeCachePath,
  runtimeCacheZipPath,
  sha256Hex,
  verifyCachedZipFile,
  verifyExtractedRuntime,
  verifyOfficialRuntimeZip,
  verifyZipSha256,
} from "./bun-runtime.ts";

// minimal stored (uncompressed) zip with one file; enough for the Bun release zips' layout
function zip(name: string, data: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const nb = enc.encode(name);
  const lh = 30 + nb.length + data.length;
  const cd = 46 + nb.length;
  const out = new Uint8Array(lh + cd + 22);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(8, 0, true); // stored
  v.setUint16(26, nb.length, true);
  out.set(nb, 30);
  out.set(data, 30 + nb.length);
  const c = lh;
  v.setUint32(c, 0x02014b50, true);
  v.setUint16(c + 8, 0, true);
  v.setUint32(c + 24, data.length, true);
  v.setUint32(c + 28, nb.length, true);
  v.setUint32(c + 42, 0, true); // local header offset
  out.set(nb, c + 46);
  const e = lh + cd;
  v.setUint32(e, 0x06054b50, true);
  v.setUint16(e + 8, 1, true);
  v.setUint16(e + 10, 1, true);
  v.setUint32(e + 12, cd, true);
  v.setUint32(e + 16, lh, true);
  return out;
}

describe("WP37c official Bun runtime", () => {
  test("WP37c release asset names follow the target", () => {
    expect(officialRuntimeAsset("linux-x64")).toBe("bun-linux-x64");
    expect(officialRuntimeAsset("linux-arm64")).toBe("bun-linux-aarch64");
    expect(officialRuntimeAsset("darwin-arm64")).toBe("bun-darwin-aarch64");
    expect(officialRuntimeAsset("windows-x64")).toBe("bun-windows-x64");
  });

  test("WP37c runtime URLs pin the running Bun version", () => {
    const urls = officialRuntimeUrls("1.4.2", "linux-x64");
    expect(urls[0]).toBe("https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip");
  });

  test("WP37c runtime cache lives under node_modules/.cache", () => {
    expect(runtimeCachePath("1.4.2", "linux-x64")).toBe("node_modules/.cache/mitori-bun-runtime/bun-1.4.2-linux-x64/bun");
    expect(runtimeCachePath("1.4.2", "windows-x64")).toBe("node_modules/.cache/mitori-bun-runtime/bun-1.4.2-windows-x64/bun.exe");
  });

  test("WP37c zip extraction finds the bundled bun executable", () => {
    const data = new TextEncoder().encode("fake-bun-bytes");
    expect(extractBunFromZip(zip("bun-linux-x64/bun", data))).toEqual(data);
  });

  test("WP37c zip extraction rejects archives without a bun executable", () => {
    expect(() => extractBunFromZip(zip("bun-linux-x64/README.md", new Uint8Array([1])))).toThrow(/bun executable/);
  });
});

describe("WP37d official Bun runtime hash pinning", () => {
  test("WP37d pinned 1.4.2 zip hashes match SHASUMS256.txt", () => {
    expect(officialRuntimeSha256("1.4.2", "linux-x64")).toBe("36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d42a913");
    expect(officialRuntimeSha256("1.4.2", "linux-arm64")).toBe("54328bbc2d9c8e0c9f2cbf544d66c57a83b84139e34909e5ee81758f1ac8fda7");
    expect(officialRuntimeSha256("1.4.2", "darwin-arm64")).toBe("90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f");
  });

  test("WP37d unknown version fails closed", () => {
    expect(() => officialRuntimeSha256("9.9.9", "linux-x64")).toThrow(/no pinned sha256/);
    expect(() => officialRuntimeUrls("9.9.9", "linux-x64")).toThrow(/no pinned sha256/);
    expect(() => verifyOfficialRuntimeZip(new Uint8Array([1]), "9.9.9", "linux-x64")).toThrow(/no pinned sha256/);
  });

  test("WP37d asset without a pin fails closed", () => {
    expect(() => officialRuntimeSha256("1.4.2", "windows-x64")).toThrow(/no pinned sha256/);
    expect(() => officialRuntimeUrls("1.4.2", "windows-x64")).toThrow(/no pinned sha256/);
  });

  test("WP37d matching sha256 passes, one byte difference fails", () => {
    const data = new TextEncoder().encode("fake-zip-bytes");
    verifyZipSha256(data, sha256Hex(data));
    const flipped = new Uint8Array(data);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => verifyZipSha256(flipped, sha256Hex(data))).toThrow(/mismatch/);
    const hex = sha256Hex(data);
    const badHex = hex.slice(0, -1) + (hex.endsWith("0") ? "1" : "0");
    expect(() => verifyZipSha256(data, badHex)).toThrow(/mismatch/);
  });

  test("WP37d pinned verification rejects bytes that do not match the lock", () => {
    const data = new TextEncoder().encode("fake-zip-bytes");
    expect(() => verifyOfficialRuntimeZip(data, "1.4.2", "linux-x64")).toThrow(/mismatch/);
  });

  test("WP37d runtime zip cache lives next to the cached executable", () => {
    expect(runtimeCacheZipPath("1.4.2", "linux-x64")).toBe("node_modules/.cache/mitori-bun-runtime/bun-1.4.2-linux-x64/bun-linux-x64.zip");
  });

  test("WP37d tampered cache zip is deleted and fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "mitori-bun-runtime-"));
    try {
      const file = join(dir, "runtime.zip");
      const data = new TextEncoder().encode("cached-zip-bytes");
      const good = sha256Hex(data);
      writeFileSync(file, data);
      verifyCachedZipFile(file, good);
      expect(existsSync(file)).toBe(true);
      const tampered = new Uint8Array(data);
      tampered[1] = (tampered[1] ?? 0) ^ 1;
      writeFileSync(file, tampered);
      expect(() => verifyCachedZipFile(file, good)).toThrow(/mismatch/);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("WP37d extracted runtime failing standalone-check is rejected", () => {
    expect(() => verifyExtractedRuntime(new TextEncoder().encode("#!/bin/sh\necho hi\n"), "linux-x64")).toThrow(/standalone/);
    verifyExtractedRuntime(new Uint8Array([1]), "windows-x64");
  });
});
