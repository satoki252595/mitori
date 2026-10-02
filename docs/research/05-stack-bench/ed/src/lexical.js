import { createEditor, $getRoot, $createParagraphNode, $createTextNode, $getSelection, $isRangeSelection } from 'lexical'
import { registerRichText, HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { CodeNode } from '@lexical/code'
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import { paint, q, heap, makeMarkdown } from './common.js'
window.__t = async (n = 2000) => {
  const md = makeMarkdown(n); const host = document.getElementById('host'); host.innerHTML = ''; host.style.cssText = 'height:600px;overflow:auto'; const h0 = heap()
  const el = document.createElement('div'); el.contentEditable = 'true'; host.append(el)
  let t = performance.now()
  const editor = createEditor({ namespace: 'm', nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode], onError: e => { throw e } })
  editor.setRootElement(el); registerRichText(editor); registerHistory(editor, createEmptyHistoryState(), 300)
  await new Promise(r => editor.update(() => { $convertFromMarkdownString(md, TRANSFORMERS) }, { onUpdate: r }))
  await paint(); const create = performance.now() - t
  const typ = []
  for (let i = 0; i < 40; i++) { const s = performance.now(); await new Promise(r => editor.update(() => { const kids = $getRoot().getChildren(); const p = kids[Math.floor(kids.length / 2)]; p.select(); const sel = $getSelection(); if ($isRangeSelection(sel)) sel.insertText('あ') }, { onUpdate: r })); await paint(); typ.push(performance.now() - s) }
  const out = { editor: 'lexical+markdown', blocks: n, mdKB: Math.round(md.length / 1024), createToPaintMs: +create.toFixed(1), typingMedianMs: q(typ, .5), typingP95Ms: q(typ, .95), domNodes: host.getElementsByTagName('*').length, heapMB: heap() && +(heap() - h0).toFixed(1) }
  editor.setRootElement(null); return out
}
