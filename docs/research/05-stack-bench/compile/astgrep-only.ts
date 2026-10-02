import { parse, Lang } from "@ast-grep/napi"
if (process.argv.includes("--selftest")) { console.log("selftest astgrep", parse(Lang.TypeScript, "export function f(){}; class Q{}").root().children().length); process.exit(0) }
