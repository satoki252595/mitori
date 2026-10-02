import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { javascript } from '@codemirror/lang-javascript'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { paint, q, heap, loadDoc } from './common.js'
window.__t = async (docName = 'big5k.ts', every = 50) => {
  const a = await loadDoc(docName); const lines = a.split('\n'); const b = lines.map((l, i) => i % every === 0 ? l + ' // changed' : l).join('\n')
  const host = document.getElementById('host'); host.innerHTML = ''; const h0 = heap(); const out = { lines: lines.length, changes: Math.ceil(lines.length / every) }
  const exts = [javascript({ typescript: true }), syntaxHighlighting(defaultHighlightStyle), EditorView.theme({ '&': { height: '500px' } })]
  let t = performance.now()
  const mv = new MergeView({ parent: host, a: { doc: a, extensions: exts }, b: { doc: b, extensions: exts }, highlightChanges: true, gutter: true })
  await paint(); out.sideBySideCreateMs = +(performance.now() - t).toFixed(1); out.sideBySideDom = host.getElementsByTagName('*').length
  const typ = []; for (let i = 0; i < 30; i++) { const s = performance.now(); mv.b.dispatch({ changes: { from: 1000 + i, insert: 'x' } }); await paint(); typ.push(performance.now() - s) }
  out.sideBySideTypingMedianMs = q(typ, .5); out.sideBySideTypingP95Ms = q(typ, .95); mv.destroy()
  host.innerHTML = ''
  t = performance.now()
  const uv = new EditorView({ parent: host, state: EditorState.create({ doc: b, extensions: [...exts, unifiedMergeView({ original: a, highlightChanges: true, gutter: true, mergeControls: true })] }) })
  await paint(); out.unifiedCreateMs = +(performance.now() - t).toFixed(1); out.unifiedDom = host.getElementsByTagName('*').length
  const typ2 = []; for (let i = 0; i < 30; i++) { const s = performance.now(); uv.dispatch({ changes: { from: 1000 + i, insert: 'x' } }); await paint(); typ2.push(performance.now() - s) }
  out.unifiedTypingMedianMs = q(typ2, .5); out.unifiedTypingP95Ms = q(typ2, .95); uv.destroy(); out.heapMB = heap() && +(heap() - h0).toFixed(1)
  return out
}
