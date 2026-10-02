import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { paint, q, heap, loadDoc } from './common.js'
window.__t = async (docName = 'big20k.ts', engineName = 'js') => {
  const doc = await loadDoc(docName); const nLines = doc.split('\n').length
  const out = { editor: 'shiki-' + engineName, lines: nLines, bytes: doc.length }
  let t = performance.now()
  const hl = await createHighlighterCore({ themes: [import('@shikijs/themes/github-light')], langs: [import('@shikijs/langs/typescript')], engine: engineName === 'js' ? createJavaScriptRegexEngine() : createOnigurumaEngine(import('shiki/wasm')) })
  out.initMs = +(performance.now() - t).toFixed(1)
  t = performance.now(); const html = hl.codeToHtml(doc, { lang: 'typescript', theme: 'github-light' }); out.highlightMs = +(performance.now() - t).toFixed(1); out.htmlKB = Math.round(html.length / 1024)
  t = performance.now(); const h2 = hl.codeToHtml(doc, { lang: 'typescript', theme: 'github-light' }); out.highlight2ndMs = +(performance.now() - t).toFixed(1)
  const host = document.getElementById('host'); host.innerHTML = ''; host.style.cssText = 'height:600px;overflow:auto'
  t = performance.now(); host.innerHTML = html; await paint(); out.insertAllToPaintMs = +(performance.now() - t).toFixed(1); out.domNodes = host.getElementsByTagName('*').length
  const st = []; for (let i = 0; i < 120; i++) { const s = performance.now(); host.scrollTop = Math.floor(Math.random() * (host.scrollHeight - 600)); await paint(); st.push(performance.now() - s) }
  out.scrollJumpMedianMs = q(st, .5); out.scrollJumpP95Ms = q(st, .95)
  // chunked: 200-line chunk highlight (typical viewport window)
  const lines = doc.split('\n'); const ch = []; for (let i = 0; i < 30; i++) { const a = Math.floor(Math.random() * (nLines - 200)); const s = performance.now(); hl.codeToHtml(lines.slice(a, a + 200).join('\n'), { lang: 'typescript', theme: 'github-light' }); ch.push(performance.now() - s) }
  out.chunk200LinesMedianMs = q(ch, .5)
  return out
}
