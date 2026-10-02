import { parentPort, workerData } from "node:worker_threads"
import { Parser, Language } from "web-tree-sitter"
await Parser.init({ wasmBinary: workerData.runtime })
const go = await Language.load(workerData.go)
const p = new Parser(); p.setLanguage(go)
parentPort!.postMessage("ready")
parentPort!.on("message", (src: string) => { const t = p.parse(src)!; parentPort!.postMessage({ n: t.rootNode.namedChildren.length }); t.delete() })
