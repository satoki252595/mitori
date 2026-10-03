import { describe, expect, test } from "bun:test";
import { cryptoRandom } from "../random/index.ts";
import { createHasher } from "./index.ts";

const h = createHasher();
const enc = new TextEncoder();

describe("PLAT-U Hasher", () => {
  test("xxh3: XXH3-64 reference vectors, 16 lowercase hex, string ≡ UTF-8 bytes", () => {
    expect(h.xxh3("")).toBe("2d06800538d394c2");
    expect(h.xxh3("abc")).toBe("78af5f94892f3950");
    expect(h.xxh3("日本語")).toBe(h.xxh3(enc.encode("日本語")));
    expect(h.xxh3("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("sha256 hex", () => {
    expect(h.sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(h.sha256(enc.encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("gitBlob matches `git hash-object` for sha1 and sha256 repos", () => {
    expect(h.gitBlob(new Uint8Array(), "sha1")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(h.gitBlob(enc.encode("hello\n"), "sha1")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(h.gitBlob(new Uint8Array(), "sha256")).toBe("473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813");
  });
});

describe("PLAT-U Random", () => {
  test("cryptoRandom returns n bytes, also beyond the 64 KiB getRandomValues limit", () => {
    expect(cryptoRandom.bytes(0).length).toBe(0);
    const big = cryptoRandom.bytes(200_000);
    expect(big.length).toBe(200_000);
    expect(big.subarray(150_000).some((b) => b !== 0)).toBe(true);
    expect(cryptoRandom.bytes(16)).not.toEqual(cryptoRandom.bytes(16));
  });
});
