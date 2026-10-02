import { EditorView, lineNumbers, Decoration, WidgetType, gutter, GutterMarker } from '@codemirror/view'
import { EditorState, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { paint, q, heap, loadDoc, anchorLines } from './common.js'
class Bubble extends WidgetType { constructor(n) { super(); this.n = n } toDOM() { const s = document.createElement('span'); s.className = 'bubble'; s.textContent = '💬' + this.n; return s } eq(o) { return o.n === this.n } }
class Mark extends GutterMarker { toDOM() { const s = document.createElement('span'); s.textContent = '●'; return s } }
const setDeco = StateEffect.define()
const decoField = StateField.define({ create: () => Decoration.none, update(v, tr) { v = v.map(tr.changes); for (const e of tr.effects) if (e.is(setDeco)) v = e.value; return v }, provide: f => EditorView.decorations.from(f) })
window.__t = async (docName = 'big20k.ts', nAnch = 1000) => {
  const doc = await loadDoc(docName); const nLines = doc.split('\n').length
  const host = document.getElementById('host'); host.innerHTML = ''
  const h0 = heap(), out = { editor: 'codemirror6', lines: nLines, bytes: doc.length }
  let t = performance.now()
  const view = new EditorView({ parent: host, state: EditorState.create({ doc, extensions: [lineNumbers(), javascript({ typescript: true }), syntaxHighlighting(defaultHighlightStyle), decoField, gutter({ class: 'g', lineMarker: (v, line) => anchorSet.has(v.state.doc.lineAt(line.from).number) ? new Mark() : null }), EditorView.theme({ '&': { height: '600px' }, '.cm-scroller': { overflow: 'auto' } })] }) })
  await paint(); out.createToPaintMs = +(performance.now() - t).toFixed(1)
  out.heapAfterCreateMB = heap() && +(heap() - h0).toFixed(1)
  const anchors = anchorLines(nLines, nAnch); var anchorSet = new Set(anchors)
  // decorations: line deco + inline widget on each anchored line
  t = performance.now()
  const b = new RangeSetBuilder(); for (const ln of anchors) { const l = view.state.doc.line(ln); b.add(l.from, l.from, Decoration.line({ class: 'anch' })); b.add(l.to, l.to, Decoration.widget({ widget: new Bubble(ln % 5), side: 1 })) }
  view.dispatch({ effects: setDeco.of(b.finish()) }); await paint()
  out.applyAnchorsMs = +(performance.now() - t).toFixed(1)
  // typing latency in the middle
  const mid = view.state.doc.line(Math.floor(nLines / 2)).to; const typ = []
  for (let i = 0; i < 60; i++) { const s = performance.now(); view.dispatch({ changes: { from: mid + i, insert: 'x' } }); const d1 = performance.now() - s; await paint(); typ.push(performance.now() - s); if (i === 0) out.firstKeySyncMs = +d1.toFixed(2) }
  out.typingMedianToPaintMs = q(typ, .5); out.typingP95ToPaintMs = q(typ, .95)
  // scroll
  const sc = view.scrollDOM; const st = []
  for (let i = 0; i < 120; i++) { const s = performance.now(); sc.scrollTop = Math.floor(Math.random() * (sc.scrollHeight - 600)); await paint(); st.push(performance.now() - s) }
  out.scrollJumpMedianMs = q(st, .5); out.scrollJumpP95Ms = q(st, .95)
  // jump-to-line (anchor navigation)
  const jt = []; for (let i = 0; i < 40; i++) { const ln = anchors[Math.floor(Math.random() * anchors.length)]; const s = performance.now(); view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(ln).from, { y: 'center' }) }); await paint(); jt.push(performance.now() - s) }
  out.jumpToAnchorMedianMs = q(jt, .5); out.domNodes = host.getElementsByTagName('*').length; out.heapTotalMB = heap() && +(heap() - h0).toFixed(1)
  view.destroy(); return out
}
