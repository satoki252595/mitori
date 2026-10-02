import fs from 'node:fs'
const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const keys = process.argv[3].split(',')
console.log(keys.join('\t'))
for (const r of rows) console.log(keys.map(k => r[k]).join('\t'))
