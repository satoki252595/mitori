// Precompiled wasm (CR-PENDING(perf)): Workers that instantiate modules compiled once on the main thread produce exactly
// what Workers loading the bytes produce, for every grammar; a module that does not match falls back to the bytes.
import { describe, expect, test } from "bun:test";
import { LANG_GRAMMAR, type ParseBatchResponse, type ParseItem } from "../contract.ts";
import { bunWorkerPool, withPrecompiled } from "./test/bun-pool.ts";
import { workerInit } from "./test/env.ts";
import { precompiledOf } from "./wasm.ts";

const SOURCES: Record<string, { lang: ParseItem["lang"]; text: string }> = {
  "a.ts": { lang: "typescript", text: "export interface P { x: number }\nexport function f(p: P): number {\n  return p.x;\n}\n" },
  "b.tsx": { lang: "tsx", text: "export const C = () => <div>{1}</div>;\n" },
  "c.js": { lang: "javascript", text: "export function g(a) {\n  return a && a.b;\n}\n" },
  "d.py": { lang: "python", text: 'def h(x):\n    """doc"""\n    return x if x else 0\n' },
  "e.go": { lang: "go", text: 'package e\n\nimport "fmt"\n\nfunc E() { fmt.Println(1) }\n' },
  "f.rs": { lang: "rust", text: "pub struct S;\nimpl S {\n    pub fn new() -> Self { S }\n}\n" },
};

const items = (): ParseItem[] =>
  Object.entries(SOURCES).map(([path, { lang, text }]) => {
    const source = new TextEncoder().encode(text);
    return {
      path,
      abs: `/nonexistent/${path}`,
      size: source.length,
      lang,
      grammar: LANG_GRAMMAR[lang],
      profile: "full",
      knownBlob: null,
      source,
      detectors: [],
      provisionalClass: "source",
      scope: "main",
    };
  });

async function parseWith(init: ReturnType<typeof workerInit>): Promise<ParseBatchResponse["items"]> {
  const pool = bunWorkerPool(init, { precompile: false })(1); // `init` is exactly what the Worker gets
  try {
    return (await pool.run({ id: 1, items: items() })).items;
  } finally {
    await pool.close();
  }
}

describe("CR-PENDING(perf) precompiled wasm in the parse Worker", () => {
  test("modules compiled once give the same results as the bytes, for all six grammars", async () => {
    const bytes = await parseWith(workerInit());
    const shared = await parseWith(withPrecompiled(workerInit()));
    expect(shared).toEqual(bytes);
    expect(bytes.every((r) => r.status === "ok" && r.extractor !== null && r.symbols.length > 0)).toBe(true);
  });

  test("an init without modules, or with something that is not a module, uses the bytes", async () => {
    const init = workerInit();
    expect(precompiledOf(init)).toBeUndefined();
    const unsupported = { ...init, runtime: new Uint8Array([0]) };
    expect(withPrecompiled(unsupported)).toBe(unsupported);
    const odd = { ...workerInit(), compiled: { runtime: "nope", grammars: { go: 42 } } } as unknown as ReturnType<typeof workerInit>;
    const res = await parseWith(odd);
    expect(res.every((r) => r.status === "ok")).toBe(true);
  });
});
