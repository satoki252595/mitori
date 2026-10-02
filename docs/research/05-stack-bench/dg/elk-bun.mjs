import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ELKApi = require('elkjs/lib/elk-api.js')
const url = new URL('./node_modules/elkjs/lib/elk-worker.min.js', import.meta.url).pathname
const elk = new ELKApi({ workerUrl: url, workerFactory: (u) => new Worker(u) })
console.log(await elk.layout({ id: 'r', children: [{ id: 'a', width: 10, height: 10 }, { id: 'b', width: 10, height: 10 }], edges: [{ id: 'e', sources: ['a'], targets: ['b'] }] }).then(r => r.children.map(c => [c.x, c.y])))
process.exit(0)
