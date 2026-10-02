import fs from 'node:fs'; import path from 'node:path'
const root = 'dist'; const files = []
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p) } }; walk(root)
// skip monaco workers for this test to keep it small? keep all
let out = files.map((f, i) => `import f${i} from './${f}' with { type: 'file' }`).join('\n') + '\n'
out += 'export const assets: Record<string,string> = {\n' + files.map((f, i) => `  ${JSON.stringify('/' + path.relative(root, f))}: f${i},`).join('\n') + '\n}\n'
fs.writeFileSync('assets.gen.ts', out); console.log(files.length, 'files')
