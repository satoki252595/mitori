import Parser from "tree-sitter"
import Go from "tree-sitter-go"
if (process.argv.includes("--selftest")) { const p = new Parser(); p.setLanguage(Go as any); console.log("selftest native-ts", p.parse("package x\nfunc A(){}").rootNode.namedChildCount); process.exit(0) }
