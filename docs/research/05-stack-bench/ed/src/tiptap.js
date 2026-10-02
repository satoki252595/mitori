import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import UniqueID from '@tiptap/extension-unique-id'
import { paint, q, heap, makeMarkdown } from './common.js'
window.__t = async (n = 2000, uid = true) => {
  const md = makeMarkdown(n); const host = document.getElementById('host'); host.innerHTML = ''; host.style.cssText = 'height:600px;overflow:auto'; const h0 = heap()
  let t = performance.now()
  const ed = new Editor({ element: host, extensions: [StarterKit, Markdown, ...(uid ? [UniqueID.configure({ types: ['heading', 'paragraph', 'codeBlock', 'listItem'] })] : [])], content: md, contentType: 'markdown' })
  await paint(); const create = performance.now() - t
  const size = ed.state.doc.content.size; const typ = []
  for (let i = 0; i < 40; i++) { const s = performance.now(); ed.commands.insertContentAt(Math.floor(size / 2) + 3, 'あ'); await paint(); typ.push(performance.now() - s) }
  const out = { editor: 'tiptap3+markdown' + (uid ? '+uniqueid' : ''), blocks: n, mdKB: Math.round(md.length / 1024), createToPaintMs: +create.toFixed(1), typingMedianMs: q(typ, .5), typingP95Ms: q(typ, .95), domNodes: host.getElementsByTagName('*').length, heapMB: heap() && +(heap() - h0).toFixed(1) }
  ed.destroy(); return out
}
