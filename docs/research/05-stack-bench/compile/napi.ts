import { parse, Lang } from "@ast-grep/napi"
import { parseSync } from "oxc-parser"
if (process.argv.includes("--selftest")) {
  const r = parse(Lang.TypeScript, "export function f(){}; class Q{}")
  const o = parseSync("a.ts", "export function f(){}; class Q{}")
  console.log("selftest napi", r.root().children().length, o.program.body.length)
  process.exit(0)
}
console.log("mitori 0.0.0")
