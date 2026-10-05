import { describe, expect, test } from "bun:test";
import { generate } from "./generators.ts";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("fixture generators (testing spec 2.1 rule 4)", () => {
  test("every sized generator is exact and deterministic", () => {
    for (const g of ["isbn-json", "ts-lines", "minified-line", "nul-blob", "md-long-block"]) {
      for (const bytes of [64, 1000, 51_201, 102_400]) {
        const a = generate({ path: "x", generator: g, bytes, seed: 3 });
        expect([g, bytes, a.length]).toEqual([g, bytes, bytes]);
        expect(generate({ path: "x", generator: g, bytes, seed: 3 })).toEqual(a);
      }
    }
    expect(generate({ path: "x", generator: "isbn-json", bytes: 5000, seed: 1 })).not.toEqual(
      generate({ path: "x", generator: "isbn-json", bytes: 5000, seed: 2 }),
    );
  });

  test("isbn-json is valid JSON of valid ISBN-13s; ts-lines is one short statement per line; minified-line is one line", () => {
    const rows = JSON.parse(text(generate({ path: "x", generator: "isbn-json", bytes: 20_000, seed: 7 }))) as { isbn: string }[];
    expect(rows.length).toBeGreaterThan(50);
    for (const { isbn } of rows) {
      const sum = [...isbn].reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
      expect([isbn, isbn.length, sum % 10]).toEqual([isbn, 13, 0]);
    }
    const ts = text(generate({ path: "x", generator: "ts-lines", bytes: 10_000, seed: 1 }));
    expect(
      ts
        .split("\n")
        .filter((l) => l && !l.startsWith("//"))
        .every((l) => /^export const row\d{6} = \[\d+, \d+\];$/.test(l)),
    ).toBe(true);
    expect(
      text(generate({ path: "x", generator: "minified-line", bytes: 5000, seed: 1 }))
        .split("\n")
        .filter(Boolean),
    ).toHaveLength(1);
  });

  test("nul-blob has NULs inside the first 8,000 bytes; md-long-block ends with a valid block id", () => {
    expect(generate({ path: "x", generator: "nul-blob", bytes: 16_384, seed: 3 }).subarray(0, 8000).includes(0)).toBe(true);
    const md = text(generate({ path: "x", generator: "md-long-block", bytes: 102_400, seed: 9 }));
    expect(md).toMatch(/^# 長い段落 <!-- b_[0-9a-hjkmnp-tv-z]{8} -->\n\n/);
    expect(md).toMatch(/ <!-- b_[0-9a-hjkmnp-tv-z]{8} -->\n$/);
  });

  test("the large-code fixture has exactly 20,000 numbered lines", () => {
    const g = { path: "src/large.ts", generator: "ts-numbered-lines", bytes: 300_000 };
    const out = generate(g);
    expect(out.length).toBe(300_000);
    const lines = text(out).trimEnd().split("\n");
    expect(lines).toHaveLength(20_000);
    expect([lines[0], lines.at(-1)]).toEqual(["// line 000001", "// line 020000"]);
    expect(generate(g)).toEqual(out);
    expect(() => generate({ ...g, bytes: 64 })).toThrow(/multiple of 15/);
  });

  test("text and hex are verbatim; bad input is E_INVALID_INPUT", () => {
    expect(text(generate({ path: "x", generator: "text", text: "a\r\nb" }))).toBe("a\r\nb");
    expect([...generate({ path: "x", generator: "hex", hex: "efbbbf00ff" })]).toEqual([0xef, 0xbb, 0xbf, 0, 0xff]);
    expect(() => generate({ path: "x", generator: "hex", hex: "abc" })).toThrow(/hex/);
    expect(() => generate({ path: "x", generator: "nope", bytes: 100 })).toThrow(/unknown fixture generator/);
    expect(() => generate({ path: "x", generator: "isbn-json" })).toThrow(/bytes/);
  });
});
