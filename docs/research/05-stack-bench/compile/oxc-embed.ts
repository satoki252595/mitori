// @ts-ignore
import nodePath from "../node_modules/@oxc-parser/binding-darwin-arm64/parser.darwin-arm64.node" with { type: "file" }
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nodePath
const { parseSync } = await import("oxc-parser")
if (process.argv.includes("--selftest")) { console.log("selftest oxc-embed", nodePath, parseSync("a.ts", "export function f(){}; class Q{}").program.body.length); process.exit(0) }
