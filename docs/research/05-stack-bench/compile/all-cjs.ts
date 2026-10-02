import { Database } from "bun:sqlite"
import { Parser, Language } from "web-tree-sitter"
import { parse, Lang } from "@ast-grep/napi"
// @ts-ignore
import oxcNode from "../node_modules/@oxc-parser/binding-darwin-arm64/parser.darwin-arm64.node" with { type: "file" }
// @ts-ignore
import runtimeWasm from "../node_modules/web-tree-sitter/web-tree-sitter.wasm" with { type: "file" }
// @ts-ignore
import goWasm from "../node_modules/tree-sitter-go/tree-sitter-go.wasm" with { type: "file" }
// @ts-ignore
import tsWasm from "../node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm" with { type: "file" }
(async () => { if (process.argv.includes("--selftest")) {
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = oxcNode
  const { parseSync } = await import("oxc-parser")
  const db = new Database(":memory:"); db.exec("create table t(a)")
  await Parser.init({ wasmBinary: new Uint8Array(await Bun.file(runtimeWasm).arrayBuffer()) })
  const go = await Language.load(new Uint8Array(await Bun.file(goWasm).arrayBuffer()))
  const p = new Parser(); p.setLanguage(go)
  console.log("selftest all", p.parse("package x\nfunc A() {}")!.rootNode.namedChildren.length, parse(Lang.TypeScript, "class Q{}").root().children().length, parseSync("a.ts", "class Q{}").program.body.length)
  process.exit(0)
}
console.log("mitori 0.0.0")
})()
