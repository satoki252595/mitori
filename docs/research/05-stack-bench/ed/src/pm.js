import { EditorState, Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown'
import { history, undo, redo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { ChangeSet } from 'prosemirror-changeset'
import { paint, q, heap, makeMarkdown } from './common.js'
window.__ChangeSet = ChangeSet; window.__ser = defaultMarkdownSerializer
window.__t = async (n = 2000) => {
  const md = makeMarkdown(n); const host = document.getElementById('host'); host.innerHTML = ''; host.style.cssText = 'height:600px;overflow:auto'; const h0 = heap()
  let t = performance.now(); const doc = defaultMarkdownParser.parse(md); const parseMs = performance.now() - t
  t = performance.now()
  const view = new EditorView(host, { state: EditorState.create({ doc, plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap)] }) })
  await paint(); const create = performance.now() - t
  let mid = 0; doc.descendants((nd, pos) => { if (nd.isTextblock && !mid && pos > doc.content.size / 2) mid = pos + 1 })
  const typ = []
  for (let i = 0; i < 40; i++) { const s = performance.now(); view.dispatch(view.state.tr.insertText('あ', mid + i)); await paint(); typ.push(performance.now() - s) }
  const out = { editor: 'prosemirror-wysiwyg', blocks: n, mdKB: Math.round(md.length / 1024), mdParseMs: +parseMs.toFixed(1), createToPaintMs: +create.toFixed(1), typingMedianMs: q(typ, .5), typingP95Ms: q(typ, .95), domNodes: host.getElementsByTagName('*').length, heapMB: heap() && +(heap() - h0).toFixed(1) }
  view.destroy(); return out
}
