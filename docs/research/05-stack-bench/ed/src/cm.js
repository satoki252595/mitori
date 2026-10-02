import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { paint, q, heap, makeMarkdown } from './common.js'
window.__t = async (n = 2000) => {
  const md = makeMarkdown(n); const host = document.getElementById('host'); host.innerHTML = ''; const h0 = heap()
  let t = performance.now()
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: md, extensions: [markdown(), syntaxHighlighting(defaultHighlightStyle), history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping, EditorView.theme({ '&': { height: '600px' }, '.cm-scroller': { overflow: 'auto' } })] }) })
  await paint(); const create = performance.now() - t
  const mid = Math.floor(md.length / 2); const typ = []
  for (let i = 0; i < 40; i++) { const s = performance.now(); view.dispatch({ changes: { from: mid + i, insert: 'あ' } }); await paint(); typ.push(performance.now() - s) }
  const out = { editor: 'codemirror6-markdown', blocks: n, mdKB: Math.round(md.length / 1024), createToPaintMs: +create.toFixed(1), typingMedianMs: q(typ, .5), typingP95Ms: q(typ, .95), domNodes: host.getElementsByTagName('*').length, heapMB: heap() && +(heap() - h0).toFixed(1) }
  view.destroy(); return out
}
