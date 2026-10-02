import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { history } from '@milkdown/kit/plugin/history'
import { paint, q, heap, makeMarkdown } from './common.js'
window.__t = async (n = 2000) => {
  const md = makeMarkdown(n); const host = document.getElementById('host'); host.innerHTML = ''; host.style.cssText = 'height:600px;overflow:auto'; const h0 = heap()
  let t = performance.now()
  const ed = await Editor.make().config(ctx => { ctx.set(rootCtx, host); ctx.set(defaultValueCtx, md) }).use(commonmark).use(history).create()
  await paint(); const create = performance.now() - t
  const view = ed.ctx.get(editorViewCtx); let mid = 0; view.state.doc.descendants((nd, pos) => { if (nd.isTextblock && !mid && pos > view.state.doc.content.size / 2) mid = pos + 1 })
  const typ = []
  for (let i = 0; i < 40; i++) { const s = performance.now(); view.dispatch(view.state.tr.insertText('あ', mid + i)); await paint(); typ.push(performance.now() - s) }
  const out = { editor: 'milkdown-commonmark', blocks: n, mdKB: Math.round(md.length / 1024), createToPaintMs: +create.toFixed(1), typingMedianMs: q(typ, .5), typingP95Ms: q(typ, .95), domNodes: host.getElementsByTagName('*').length, heapMB: heap() && +(heap() - h0).toFixed(1) }
  await ed.destroy(); return out
}
