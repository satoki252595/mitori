// WASM loading for the parse Worker: from bytes (the contract's `ParseWorkerInit`), or from `WebAssembly.Module`s the
// pool factory compiled once for every Worker. JSC shares a module's compiled and tiered-up code between the instances
// of all threads, so N Workers neither compile tree-sitter N times nor each pay the OMG tier-up and its memory
// (measured: crit cold S0–S1 −17 %, peak RSS −115 MB at W = 6; docs/progress/perf.md).
import { Language } from "web-tree-sitter";
import type { GrammarId, ParseWorkerInit } from "../contract.ts";

/**
 * CR perf-1: the structural `ParseWorkerInit.compiled` port (docs/design/cr-requests/perf.md §1). The factory posts compiled
 * modules next to the bytes (structured clone shares a `WebAssembly.Module`); the bytes stay the fallback.
 */
export interface PrecompiledWasm {
  runtime?: WebAssembly.Module;
  grammars?: Partial<Record<GrammarId, WebAssembly.Module>>;
}

/** Compile once on the pool's thread; unsupported runtimes keep the worker's existing byte loader. */
export function withPrecompiled<T extends Pick<ParseWorkerInit, "runtime" | "grammars">>(init: T): T & { compiled?: PrecompiledWasm } {
  try {
    const grammars: NonNullable<PrecompiledWasm["grammars"]> = {};
    for (const [g, bytes] of Object.entries(init.grammars)) grammars[g as GrammarId] = new WebAssembly.Module(bytes as BufferSource);
    const compiled = { runtime: new WebAssembly.Module(init.runtime as BufferSource), grammars };
    structuredClone(compiled); // detect unsupported module cloning before a Worker is started
    return { ...init, compiled };
  } catch {
    return init;
  }
}

/** The precompiled modules an init message carries, if any. */
export function precompiledOf(init: ParseWorkerInit): PrecompiledWasm | undefined {
  const c = (init as ParseWorkerInit & { compiled?: PrecompiledWasm }).compiled;
  return c !== undefined && typeof c === "object" ? c : undefined;
}

type Instantiate = (src: unknown, imports?: WebAssembly.Imports) => Promise<unknown>;
const wasm = WebAssembly as unknown as { instantiate: Instantiate };

/** `Parser.init` options: the emscripten `instantiateWasm` hook instantiates the shared module (bytes on failure). */
export function runtimeOptions(init: ParseWorkerInit, compiled: PrecompiledWasm | undefined): object {
  const binary = init.runtime; // the runtime fallback must not retain the init's entire grammar byte map
  const mod = compiled?.runtime;
  if (!(mod instanceof WebAssembly.Module)) return { wasmBinary: binary };
  return {
    wasmBinary: binary,
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void): object {
      WebAssembly.instantiate(mod, imports).then(
        (instance) => done(instance, mod),
        () =>
          // emscripten passes no reject: a module that does not instantiate falls back to the bytes
          WebAssembly.compile(binary as BufferSource).then((m) => WebAssembly.instantiate(m, imports).then((instance) => done(instance, m))),
      );
      return {};
    },
  };
}

let loading: Promise<unknown> = Promise.resolve();

/**
 * `Language.load(bytes)`, answered from `mod` when given: web-tree-sitter instantiates exactly the bytes it is handed,
 * so for the duration of the load that one `WebAssembly.instantiate(bytes, …)` call uses the compiled module (any other
 * call passes through; loads are serialized so two never overlap the hook).
 */
export function loadLanguage(bytes: Uint8Array, mod: WebAssembly.Module | undefined): Promise<Language> {
  if (!(mod instanceof WebAssembly.Module)) return Language.load(bytes);
  const run = loading.then(async () => {
    const orig = wasm.instantiate;
    wasm.instantiate = (src, imports) =>
      src === bytes
        ? (orig.call(WebAssembly, mod, imports) as Promise<WebAssembly.Instance>).then((instance) => ({ module: mod, instance }))
        : orig.call(WebAssembly, src, imports);
    try {
      return await Language.load(bytes);
    } finally {
      wasm.instantiate = orig;
    }
  });
  loading = run.catch(() => undefined);
  return run;
}
