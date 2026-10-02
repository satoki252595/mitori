export const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
export const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(b.length * p))].toFixed(2) }
export const heap = () => performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
const JA = ['この関数はリポジトリ全体を一度だけ読み込み、設計書の該当箇所にコメントを紐づけます。', '非機能要件として処理速度とトークン量を重視し、差分更新で再生成を最小限に抑えます。', 'レビューコメントは安定したブロック識別子に固定され、AIエージェントが該当コードを修正します。']
const EN = ['The indexer walks the tree once and caches symbol tables keyed by content hash.', 'Each block carries a stable identifier so comments survive regeneration of the document.']
export function makeMarkdown(nBlocks) {
  const out = []
  for (let i = 0; i < nBlocks; i++) {
    const k = i % 10
    if (k === 0) out.push(`## セクション ${i / 10 + 1}: Module ${i}\n`)
    else if (k === 5) out.push('```ts\nexport function f' + i + '(a: number) {\n  return a + ' + i + '\n}\n```\n')
    else if (k === 7) out.push(`- ${JA[i % 3]}\n- ${EN[i % 2]}\n- 項目 ${i}\n`)
    else out.push((i % 2 ? JA : EN)[i % (i % 2 ? 3 : 2)] + ` (#${i})\n`)
  }
  return out.join('\n')
}
