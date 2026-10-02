import { parseSync } from "oxc-parser"
if (process.argv.includes("--selftest")) { console.log("selftest oxc", parseSync("a.ts", "export function f(){}; class Q{}").program.body.length); process.exit(0) }
