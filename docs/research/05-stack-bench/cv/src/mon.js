import * as monaco from 'monaco-editor/editor/editor.main'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import { paint, q, heap, loadDoc, anchorLines } from './common.js'
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
window.__t = async (docName = 'big20k.ts', nAnch = 1000) => {
  const doc = await loadDoc(docName); const nLines = doc.split('\n').length
  const host = document.getElementById('host'); host.innerHTML = ''; host.style.height = '600px'
  const h0 = heap(), out = { editor: 'monaco', lines: nLines, bytes: doc.length }
  let t = performance.now()
  const ed = monaco.editor.create(host, { value: doc, language: 'java', automaticLayout: true, minimap: { enabled: false } })
  await paint(); out.createToPaintMs = +(performance.now() - t).toFixed(1); out.heapAfterCreateMB = heap() && +(heap() - h0).toFixed(1)
  const anchors = anchorLines(nLines, nAnch)
  t = performance.now()
  const coll = ed.createDecorationsCollection(anchors.map(ln => ({ range: new monaco.Range(ln, 1, ln, 1), options: { isWholeLine: true, className: 'anch', glyphMarginClassName: 'gm', after: { content: ' 💬' + (ln % 5) } } })))
  await paint(); out.applyAnchorsMs = +(performance.now() - t).toFixed(1)
  const mid = Math.floor(nLines / 2); const typ = []
  const col = ed.getModel().getLineMaxColumn(mid)
  for (let i = 0; i < 60; i++) { const s = performance.now(); ed.executeEdits('t', [{ range: new monaco.Range(mid, col + i, mid, col + i), text: 'x' }]); const d1 = performance.now() - s; await paint(); typ.push(performance.now() - s); if (i === 0) out.firstKeySyncMs = +d1.toFixed(2) }
  out.typingMedianToPaintMs = q(typ, .5); out.typingP95ToPaintMs = q(typ, .95)
  const st = []; for (let i = 0; i < 120; i++) { const s = performance.now(); ed.setScrollTop(Math.floor(Math.random() * (ed.getScrollHeight() - 600))); await paint(); st.push(performance.now() - s) }
  out.scrollJumpMedianMs = q(st, .5); out.scrollJumpP95Ms = q(st, .95)
  const jt = []; for (let i = 0; i < 40; i++) { const ln = anchors[Math.floor(Math.random() * anchors.length)]; const s = performance.now(); ed.revealLineInCenter(ln); await paint(); jt.push(performance.now() - s) }
  out.jumpToAnchorMedianMs = q(jt, .5); out.domNodes = host.getElementsByTagName('*').length; out.heapTotalMB = heap() && +(heap() - h0).toFixed(1)
  ed.dispose(); return out
}
