import { Worker } from "node:worker_threads"
// @ts-ignore
import runtimeWasm from "../../node_modules/web-tree-sitter/web-tree-sitter.wasm" with { type: "file" }
// @ts-ignore
import goWasm from "../../node_modules/tree-sitter-go/tree-sitter-go.wasm" with { type: "file" }
const N = +(process.argv[2] ?? 4)
const t0 = performance.now()
const wasms = { runtime: new Uint8Array(await Bun.file(runtimeWasm).arrayBuffer()), go: new Uint8Array(await Bun.file(goWasm).arrayBuffer()) }
const workers = Array.from({ length: N }, () => new Worker(new URL("./worker.ts", import.meta.url), { workerData: wasms }))
await Promise.all(workers.map(w => new Promise(r => w.once("message", r))))
const t1 = performance.now()
const src = "package x\n" + "func A() {}\n".repeat(2000)
const res = await Promise.all(workers.map(w => new Promise<number>(r => { w.once("message", (m: any) => r(m.n)); w.postMessage(src) })))
console.log("workers", N, "ready ms", Math.round(t1 - t0), "parse ms", Math.round(performance.now() - t1), "symbols", res.reduce((a, b) => a + b, 0))
process.exit(0)
