import { Parser, Language } from "web-tree-sitter"
// @ts-ignore
import runtimeWasm from "../node_modules/web-tree-sitter/web-tree-sitter.wasm" with { type: "file" }
// @ts-ignore
import goWasm from "../node_modules/tree-sitter-go/tree-sitter-go.wasm" with { type: "file" }
// @ts-ignore
import tsWasm from "../node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm" with { type: "file" }
if (process.argv.includes("--selftest")) {
  const t0 = performance.now()
  await Parser.init({ wasmBinary: new Uint8Array(await Bun.file(runtimeWasm).arrayBuffer()) })
  const go = await Language.load(new Uint8Array(await Bun.file(goWasm).arrayBuffer()))
  const ts = await Language.load(new Uint8Array(await Bun.file(tsWasm).arrayBuffer()))
  const p = new Parser(); p.setLanguage(go)
  const t = p.parse("package x\nfunc A() {}\nfunc B() {}\n")
  p.setLanguage(ts); const t2 = p.parse("export function f(){}; class Q{}")
  console.log("selftest wts", t!.rootNode.namedChildren.length, t2!.rootNode.namedChildren.length, "init+load ms", Math.round(performance.now() - t0))
  process.exit(0)
}
console.log("mitori 0.0.0")
