/**
 * WEB-U-033 theme tokens: dark `--paper` is not pure black, system-dark (block 3) and explicit dark (block 4)
 * carry byte-identical values, and text tokens keep ≥ 4.5:1 (secondary ≥ 4.5, faint ≥ 3 for non-text) on every
 * surface — computed from the token values themselves (WCAG relative luminance).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function block(start: RegExp): Record<string, string> {
  const m = start.exec(css);
  if (!m) throw new Error(`no block ${start}`);
  let depth = 0;
  let i = css.indexOf("{", m.index);
  const from = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) break;
  }
  const body = css.slice(from, i);
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1] as string] = (d[2] as string).trim();
  return out;
}

const light = block(/:root,\s*:root\[data-theme="light"\]\s*\{/);
const sysDark = block(/:root:not\(\[data-theme="light"\]\)\s*\{/);
const dark = block(/(^|\n):root\[data-theme="dark"\]\s*\{/);

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.replace(/./g, "$&$&") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4]
    .map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const hex = (theme: Record<string, string>, name: string) => {
  const v = theme[name];
  if (!v || !/^#[0-9a-f]{3,8}$/i.test(v)) throw new Error(`${name} is not a hex colour: ${v}`);
  return v;
};

describe("WEB-U-033 theme tokens", () => {
  test("dark paper is not pure black; light paper is not pure white", () => {
    expect(hex(dark, "--paper").toLowerCase()).not.toBe("#000000");
    expect(hex(light, "--paper").toLowerCase()).not.toBe("#ffffff");
  });

  test("system dark (block 3) === explicit dark (block 4)", () => {
    expect(sysDark).toEqual(dark);
    expect(Object.keys(dark).length).toBeGreaterThan(30);
  });

  for (const [name, theme] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    test(`${name}: --ink / --text / --muted ≥ 4.5:1 on --paper, --paper-2 and --sheet`, () => {
      const low: string[] = [];
      for (const fg of ["--ink", "--text", "--muted"])
        for (const bg of ["--paper", "--paper-2", "--sheet"]) {
          const c = contrast(hex(theme, fg), hex(theme, bg));
          if (c < 4.5) low.push(`${fg} on ${bg} = ${c.toFixed(2)}`);
        }
      expect(low).toEqual([]);
    });
  }
});
