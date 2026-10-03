import { describe, expect, test } from "bun:test";
import { canonicalJson } from "./canonical-json.ts";
import { MitoriError } from "./errors.ts";

describe("CORE-U-002 canonical JSON", () => {
  test("sorts keys by UTF-16 code unit (also integer-like keys), 2-space indent, trailing LF", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: true, c: null }], "10": 0, "9": 0, B: "x" })).toBe(
      '{\n  "10": 0,\n  "9": 0,\n  "B": "x",\n  "a": [\n    1,\n    {\n      "c": null,\n      "d": true\n    }\n  ],\n  "b": 1\n}\n',
    );
    expect(canonicalJson([])).toBe("[]\n");
    expect(canonicalJson({})).toBe("{}\n");
    expect(canonicalJson("x")).toBe('"x"\n');
  });

  test("-0 is 0, undefined members are omitted, array holes become null, toJSON honoured", () => {
    expect(canonicalJson({ z: -0, u: undefined, f: () => 1 })).toBe('{\n  "z": 0\n}\n');
    expect(canonicalJson([undefined, -0])).toBe("[\n  null,\n  0\n]\n");
    expect(canonicalJson({ d: new Date(0) })).toBe('{\n  "d": "1970-01-01T00:00:00.000Z"\n}\n');
  });

  test("does not escape Unicode", () => {
    expect(canonicalJson({ 見取り図: "設計書 🗺" })).toBe('{\n  "見取り図": "設計書 🗺"\n}\n');
  });

  test("rejects NaN, Infinity, bigint, cycles, non-serializable roots", () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, { x: Number.NEGATIVE_INFINITY }, 1n, cyc, undefined]) {
      expect(() => canonicalJson(bad)).toThrow(MitoriError);
    }
  });

  test("same value ⇒ same bytes regardless of key insertion order (1,000 seeded examples)", () => {
    let s = 7;
    const rnd = (n: number) => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s % n;
    };
    const keys = ["a", "b", "B", "_", "10", "9", "あ", "aa", "a-b"];
    const gen = (depth: number): unknown => {
      const k = rnd(depth > 2 ? 4 : 7);
      if (k === 0) return rnd(2) === 0;
      if (k === 1) return rnd(1000) - 500 + (rnd(2) ? 0.5 : 0);
      if (k === 2) return keys[rnd(keys.length)];
      if (k === 3) return null;
      if (k === 4) return Array.from({ length: rnd(4) }, () => gen(depth + 1));
      const o: Record<string, unknown> = {};
      for (let i = rnd(5); i > 0; i--) o[keys[rnd(keys.length)] as string] = gen(depth + 1);
      return o;
    };
    const shuffle = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(shuffle);
      if (v && typeof v === "object") {
        const entries = Object.entries(v).reverse();
        return Object.fromEntries(entries.map(([k, x]) => [k, shuffle(x)]));
      }
      return v;
    };
    for (let i = 0; i < 1000; i++) {
      const v = gen(0);
      const a = canonicalJson(v);
      expect(canonicalJson(shuffle(v))).toBe(a);
      expect(JSON.parse(a)).toEqual(JSON.parse(JSON.stringify(v)));
    }
  });
});
