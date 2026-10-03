import { describe, expect, test } from "bun:test";
import { type Hasher, ID_ALPHABET, ID_SPEC, type IdKind, type Random } from "./domain.ts";
import { base32, glossaryId, isId, newId, staticBlockId } from "./ids.ts";

/** Deterministic Random (mulberry32) — the real seeded implementation lives in @mitori/testkit. */
function seeded(seed: number): Random {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) & 0xff;
  };
  return { bytes: (n) => Uint8Array.from({ length: n }, next) };
}

const xxh3: Hasher = {
  xxh3: (d) => Bun.hash.xxHash3(d).toString(16).padStart(16, "0"),
  sha256: () => "",
  gitBlob: () => "",
};

/** RFC 4648 base32 (upper, no padding) mapped index-by-index onto the Crockford alphabet. */
const RFC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const fromRfc = (s: string) => [...s.replace(/=+$/, "")].map((c) => ID_ALPHABET[RFC.indexOf(c)]).join("");

describe("CORE-U-001 ids", () => {
  test("base32 matches RFC 4648 vectors (mapped to the Crockford alphabet)", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "MY======"],
      ["fo", "MZXQ===="],
      ["foo", "MZXW6==="],
      ["foob", "MZXW6YQ="],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI======"],
    ];
    for (const [plain, rfc] of vectors) expect(base32(new TextEncoder().encode(plain))).toBe(fromRfc(rfc));
  });

  test("alphabet is lowercase Crockford without i l o u", () => {
    expect(ID_ALPHABET).toHaveLength(32);
    expect(new Set(ID_ALPHABET).size).toBe(32);
    expect(ID_ALPHABET).not.toMatch(/[ilou]/);
    expect(base32(Uint8Array.from({ length: 64 }, (_, i) => i * 37))).toMatch(/^[0-9a-hjkmnp-tv-z]+$/);
  });

  test("every ID_SPEC kind: prefix, body length, alphabet; same seed ⇒ same ids", () => {
    const kinds = Object.keys(ID_SPEC) as IdKind[];
    const a = seeded(20261003);
    const b = seeded(20261003);
    for (const kind of kinds) {
      const id = newId(kind, a);
      const { prefix, len } = ID_SPEC[kind];
      expect(id.startsWith(prefix)).toBe(true);
      expect(id).toHaveLength(prefix.length + len);
      expect(isId(kind, id)).toBe(true);
      expect(newId(kind, b)).toBe(id);
    }
    expect(newId("block", seeded(1))).not.toBe(newId("block", seeded(2)));
  });

  test("newId draws exactly ceil(len·5/8) bytes", () => {
    const asked: number[] = [];
    const r: Random = {
      bytes: (n) => {
        asked.push(n);
        return new Uint8Array(n);
      },
    };
    newId("block", r);
    newId("message", r);
    newId("usage", r);
    expect(asked).toEqual([5, 7, 8]);
    expect(newId("block", r)).toBe("b_00000000");
    expect(() => newId("block", { bytes: () => new Uint8Array(1) })).toThrow();
  });

  test("isId rejects wrong prefix, length and alphabet", () => {
    expect(isId("block", "b_abcdefgh")).toBe(true);
    expect(isId("block", "th_abcdefgh")).toBe(false);
    expect(isId("block", "b_abcdefg")).toBe(false);
    expect(isId("block", "b_abcdefgi")).toBe(false);
    expect(isId("block", 42)).toBe(false);
  });

  test("staticBlockId = b_ + base32(xxh3(docId NUL slot) as 8 BE bytes)[:8] (golden)", () => {
    const id = staticBlockId(xxh3, "doc_000000000000", "overview");
    // xxh3("doc_000000000000\0overview") = 5b6ab3fba369f2c4
    expect(id).toBe(`b_${base32(Uint8Array.from([0x5b, 0x6a, 0xb3, 0xfb, 0xa3, 0x69, 0xf2, 0xc4])).slice(0, 8)}`);
    expect(id).toBe("b_bdnb7yx3");
    expect(staticBlockId(xxh3, "doc_000000000000", "overview")).toBe(id);
    expect(staticBlockId(xxh3, "doc_000000000001", "overview")).not.toBe(id);
    expect(() => staticBlockId({ ...xxh3, xxh3: () => "XYZ" }, "doc_000000000000", "s")).toThrow();
  });

  test("glossaryId normalizes lower() then NFKC()", () => {
    const a = glossaryId(xxh3, "doc_000000000000", "API");
    expect(a).toMatch(/^gl_[0-9a-hjkmnp-tv-z]{8}$/);
    expect(glossaryId(xxh3, "doc_000000000000", "api")).toBe(a);
    expect(glossaryId(xxh3, "doc_000000000000", "ＡＰＩ")).toBe(a);
    expect(glossaryId(xxh3, "doc_000000000000", "apis")).not.toBe(a);
  });
});
